/**
 * hive.js
 * Copyright (C) 2013-2015 Marcel Klehr <mklehr@gmx.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
"use strict";
var koa = require('koa')
  , mount = require('koa-mount')
  , router = require('koa-router')
  , jsonBody = require('koa-json-body')
  , parseUpload = require('co-busboy')
  , WritableBuffer = require('stream-buffers').WritableStreamBuffer
  , JSONAPI = require('waterline-to-jsonapi')
  , qs = require('qs')

module.exports = setup
module.exports.consumes = ['http', 'auth', 'hooks', 'orm', 'sync', 'ot', 'importexport']

function setup(plugin, imports, register) {
  var httpApp = imports.http
    , auth = imports.auth
    , hooks = imports.hooks
    , orm = imports.orm
    , sync = imports.sync
    , ot = imports.ot
    , importexport = imports.importexport

  var api = koa()
  httpApp.use(mount('/api', api))

  var APIv1 = koa()
  api.use(mount('/v1', APIv1))

  APIv1.use(function *(next) {
    try { 
      if(!this.accepts('application/vnd.api+json')) {
	return this.throw(406)
      }
      yield next;
    } catch (err) {
      this.app.emit('error', err, this)
      this.status = err.status || 500
      this.body = JSONAPI().errors(err)
    }
  })

  APIv1.use(function* (next) {
    var credentials = this.request.query.access_token
      , type = "token"
    if(!credentials) {
      credentials = this.get('Authorization')
      if(!credentials) return this.throw(401)
      var credParts = credentials.split(' ')
      type = credParts[0]
      credentials = credParts[1]
    }
    try {
      this.user = yield auth.authenticate(type, credentials)
    }catch(e) {console.log(e.stack ||e)}
    
    if(!this.user) {
      return this.throw(401)
    }
    yield next    
  })

  APIv1.use(router(APIv1))

  function toWaterline(jsonAPIBody) {
    if(Array.isArray(jsonAPIBody.data)) return jsonAPIBody.data.map(toWaterline)
    var newItem = jsonAPIBody.data.attributes || {id: jsonAPIBody.data.id}
    for(var rel in jsonAPIBody.data.relationships) {
      var linkage = jsonAPIBody.data.relationships[rel].data
      if(Array.isArray(linkage)) {
	newItem[rel] = linkage.map(resource => resource.id)
      }else if(linkage) {
	newItem[rel] = linkage.id
      }
    }
    return newItem
  }

  hooks.on('orm:initialized', function*(models) {
    var VERBS = ['post', 'get', 'patch', 'delete', 'put']
      , jsonapi = JSONAPI(orm)

    Object.keys(orm.collections).forEach((model) => {
      
      // Routes for CRUD

      APIv1.post('/'+model+'s', jsonBody(), function*(next) {
	if(!(yield auth.authorize(this.user, model+':create', {body: this.request.body}))) {
	  this.throw(403)
	}
        if(!this.is('application/vnd.api+json')) {
          this.throw(415) // Unsupported media type
        }

	// Build a waterline-conformant object
	var newItem = toWaterline(this.request.body)
	  , data
	// create item
	if(orm.collections[model].override_create) {
	  data = yield orm.collections[model].override_create(newItem)
	}else {
	  data = yield orm.collections[model].create(newItem)
	}

        this.status = 201
	this.body = jsonapi.single(data, model, {fields: qs.parse(this.querystring).fields})
      })

      APIv1.get('/'+model+'s/:id', function*(next) {
        if(!(yield auth.authorize(this.user, model+':read', {id: this.params.id}))) {
          this.throw(403)
        }
        
	var data = yield orm.collections[model].findOne({id: this.params.id})
	if(!data) this.throw(404)
        this.body = jsonapi.single(data, model, {fields: qs.parse(this.querystring).fields})
      })

      APIv1.patch('/'+model+'s/:id', jsonBody(), function*(next) {
	if(!(yield auth.authorize(this.user, model+':write', {body: this.request.body, id: this.params.id}))) {
	  this.throw(403)
	}
        if(!this.is('application/vnd.api+json')) {
          this.throw(415) // Unsupported media type
        }
	if(this.request.body.data.id !== this.params.id) {
	  this.throw(409)
	}
        var oldModel
	if(!(oldModel = yield orm.collections[model].findOne({id: this.params.id}))) {
	  this.throw(404)
	}
	yield orm.collections[model].update({id: this.params.id}, toWaterline(this.request.body))
	var data = yield orm.collections[model].findOne({id: this.params.id})
        this.body = jsonapi.single(data, model, {fields: qs.parse(this.querystring).fields})
      })
      
      APIv1.delete('/'+model+'s/:id', function * (next) {
	if(!(yield auth.authorize(this.user, model+':destroy', {id: this.params.id}))) {
	  this.throw(403)
	}

	var item = yield orm.collections[model].findOne({id: this.params.id})
	if(!item) this.throw(404)
	yield item.destroy()

	this.status = 204 // No Content
        this.body = null
      })

      // Routes for relationships

      Object.keys(orm.collections[model]._attributes)
      .filter((attr) => {
        // only relations
        return models[model].attributes[attr].model
        || models[model].attributes[attr].collection
      })
      .forEach((relation) => {
        var isToMany = !!models[model].attributes[relation].collection
          , relatedModel = models[model].attributes[relation].model
                         || models[model].attributes[relation].collection

        APIv1.get('/'+model+'s/:id/relationships/'+relation, function*(next) {
          // XXX: Not sure how to infer a sensible authorize token
          if(!(yield auth.authorize(this.user, model+':read', {id: this.params.id}))) {
	    this.throw(403)
          }

          var item = yield orm.collections[model].findOne({id: this.params.id}).populate(relation)
          if(!item) this.throw(404)
          this.body = jsonapi.relation(item, model, relation, {fields: qs.parse(this.querystring).fields})
        })

        if(!isToMany) {
          APIv1.patch('/'+model+'s/:id/relationships/'+relation, jsonBody(), function*(next) {
            if(!(yield auth.authorize(this.user, model+':read', {id: this.params.id}))) {
	      this.throw(403)
	    }

            if(!this.is('application/vnd.api+json')) {
              this.throw(415) // Unsupported media type
            }

            var item = yield orm.collections[model].findOne({id: this.params.id})

            // Not found?
            if(!item) {
              this.throw(404)
            }

            var data = toWaterline(this.request.body)

            // This is a to-one relation... No arrays!
            if(Array.isArray(data)) {
              this.throw(400)
            }

            item[relation] = null !== data? data.id : null
            yield item.save()

            // all is well? Say nothing.
            this.status = 204
            this.body = null
          })
        }else{
          APIv1.patch('/'+model+'s/:id/relationships/'+relation, function*(next) {
            this.throw(403)
          })

          APIv1.post('/'+model+'s/:id/relationships/'+relation, jsonBody(), function*(next) {
            if(!(yield auth.authorize(this.user, model+':read', {id: this.params.id}))) {
	      this.throw(403)
            }
            if(!this.is('application/vnd.api+json')) {
              this.throw(415) // Unsupported media type
            }
            var item = yield orm.collections[model].findOne({id: this.params.id})

            // Not found?
            if(!item) {
              this.throw(404)
            }

            var data = toWaterline(this.request.body)

            // Must be an array
            if(!Array.isArray(data)) {
              this.throw(400)
            }

            // check all first
            for(var i=0; i < data.length; i++) {
              var newRel = data[i]
              if(!(yield orm.collections[relatedModel].findOne({id: newRel.id}))) {
                this.throw(400)
              }
            }
            // ... then add them all
            for(var i=0; i < data.length; i++) {
              var newRel = data[i]
              item[relation].add(newRel.id)
            }
            yield item.save()

            // All is well? Say nothing.
            this.status = 204
            this.body = null
          })

          APIv1.delete('/'+model+'s/:id/relationships/'+relation, jsonBody(), function*(next) {
            if(!(yield auth.authorize(this.user, model+':read', {id: this.params.id}))) {
	      this.throw(403)
	    }
            var item = yield orm.collections[model].findOne({id: this.params.id})
            var data = toWaterline(this.request.body)

            // Must be an array
            if(!Array.isArray(data)) {
              this.throw(400) 
            }

            for(var i=0; i < data.length; i++) {
              var newRel = data[i]
              item[relation].remove(newRel.id)
            }
            yield item.save()

            // All is well? Say nothing.
            this.status = 204
            this.body = null
          })
        }
      })

      // Routes for class methods      

      Object.keys(orm.collections[model]).forEach((method) => {
        // Automatically create routes for VERB_action class methods -> VERB /models/:id/action
        if(VERBS.some((verb) => method.indexOf(verb+'_') === 0)) {
          var verb = method.split('_')[0]
            , action = method.substr(verb.length+1)
          APIv1[verb]('/'+model+'s/:id/'+action, jsonBody(), models[model][method])
        }else
        // Automatically create routes for VERB class methods -> VERB /models/:id?
        if(VERBS.some((verb) => method.indexOf(verb) === 0)) {
          var verb = method.split('_')[0]
            , action = method.substr(verb.length+1) 
          APIv1[verb]('/'+model+'s/:id?', jsonBody(), models[model][method])
        }
      })
    })

    var Document = models.document
      , Snapshot = models.snapshot
      , User = models.user

    APIv1
      .post('/documents/:document/snapshots', jsonBody(), function * (next) {
          if(!(yield auth.authorize(this.user, 'document:change', this.params))) {
            return this.throw(403)
          }
          if(!this.accepts('json')) {
           return this.throw(406)
          }
          var doc = yield Document.findOne({id: this.params.document})
          if(!doc) this.throw(404)

          doc = yield sync.getDocument(doc.id)
          var edit = yield function(cb) {
            doc.receiveEdit(JSON.stringify({
              cs: this.request.body.changes
            , parent: this.request.body.parent
            , user: this.user
            }), null, cb)
          }

          this.body = yield Snapshot.findOne({id: edit.id})
        })

      .post('/documents/:document/import', function * (next) {
          if(!(yield auth.authorize(this.user, 'document:change', this.params))) {
            return this.throw(403)
          }
          var doc = yield Document.findOne({id: this.params.document})
          if(!doc) this.throw(404)

          try {
            var parts = parseUpload(this, { autoFields: true})
              , part, bufferStream
            while(part = yield parts) {
              bufferStream = new WritableBuffer()
              var interval = setInterval(() => {
                if(bufferStream.size() > 8*1024*1024) {
                  part.unpipe()
                  this.throw('Attachment is bigger than 8MB', 400)
                  clearInterval(interval)
                }
              }, 100)
              yield function (cb) {
                part.on('end', cb)
                part.pipe(bufferStream)
              }
              clearInterval(interval)
              yield importexport.import(doc.id, this.user
              , part.mime, bufferStream.getContents())
            }
          }catch(e) {
            console.error(e.stack ||e)
            return this.throw(e.message, 500)
          }

          this.body = {message: 'ok'}
        })

      .get('/documents/:document/snapshots', function * (next) {
          if(!(yield auth.authorize(this.user, 'document:read', this.params))) {
            return this.throw(403)
          }

          // returns all snapshots since X
          if(this.query.since) {
            var sinceSnapshot = yield Snapshot.findOne({id: this.query.since})
            if(!sinceSnapshot) this.throw(404)
            if(sinceSnapshot.document != this.params.document) this.throw(400)

            var snapshots = []
             , s = sinceSnapshot
            while(s = yield Snapshot.findOne({parent: s.id}) ) {
              snapshots.push(s)
            }
            this.body = snapshots
            return
          }

          var doc = yield Document.findOne({id: this.params.document}).populate('snapshots')
          this.body = doc.snapshots // XXX: Allow streamin'
        })

      .get('/snapshots/:snapshot/export', function * () {
        if(!(yield auth.authorize(this.user, 'snapshot:show', this.params))) {
          return this.throw(403)
        }
        var snapshot = yield Snapshot.findOne({id:this.params.snapshot})
        if(!snapshot) this.throw(404)
        var document = yield Document.findOne({id:snapshot.document})
        var type = this.query.type || document.type
        this.type = type
        this.body = yield importexport.export(snapshot.id, type)
      })
  })

  register()
}
