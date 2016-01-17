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
      yield next;
    } catch (err) {
      this.status = err.status || 500;
      this.body = {message: err.message};
      this.app.emit('error', err, this);
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

  hooks.on('orm:initialized', function*(models){
    var Document = models.document
      , Snapshot = models.snapshot
      , User = models.user

    APIv1
      .post('/documents', jsonBody(), function*(next) {
          if(!this.accepts('json')) {
           return this.throw(406)
          }
          if(!(yield auth.authorize(this.user, 'document:create', this.params))) {
           return this.throw(403)
          }

          try {
            var doc = yield sync.createDocument(this.request.body.type)
          }catch(e) {
            this.throw(400, e)
          }

          this.body = doc
      })
      .get('/documents/:document', function * (next) {
          if(!(yield auth.authorize(this.user, 'document:show', this.params))) {
            return this.throw(403)
          }
          var doc = yield Document.findOne({id: this.params.document})
          if(!doc) this.throw(404)
          this.body = doc
        })
      .put('/documents/:document', jsonBody(), function*(next) {
          var params = Object.create(this.params)
          params.data = this.request.body
          if(!(yield auth.authorize(this.user, 'document:write', params))) {
            return this.throw(403)
          }
          yield Document.update({id: this.params.document}, this.request.body)
          this.body = yield Document.findOne({id: this.params.document})
        })
      .delete('/documents/:document', function * (next) {
          if(!(yield auth.authorize(this.user, 'document:destroy', this.params))) {
            return this.throw(403)
          }

          var doc = yield Document.findOne({id: this.params.document})
          if(!doc) this.throw(404)
          yield doc.destroy() // XXX: Remove all snapshots
          this.body = {message: 'ok'}
        })

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

      .get('/documents/:document/authors', function * (next) {
          if(!(yield auth.authorize(this.user, 'document/authors:index', this.params))) {
            return this.throw(403)
          }
          var doc = yield Document.findOne({id: this.params.document}).populate('authors')
          this.body = doc.authors
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

      .post('/users', jsonBody(), function*(next) {
          if(!this.accepts('json')) {
            return this.throw(406)
          }
          if(!(yield auth.authorize(this.user, 'user:create', this.params))) {
            return this.throw(403)
          }

          var user = yield User.findOne({ type: this.request.body.type
                                        , foreignId: this.request.body.foreignId})
          // prevent user duplicates of same type+foreignId
          if(user) {
            this.body = user
            return
          }

          user = yield User.create({
            name: this.request.body.name
          , type: this.request.body.type
          , foreignId: this.request.body.foreignId
          })
          this.body = user
        })
      .get('/users/:user', function*(next) {
          if(!(yield auth.authorize(this.user, 'user:show', this.params))) {
            return this.throw(403)
          }
          var user = yield User.findOne({id: this.params.user}) // XXX: Might require Document.exists() beforehand to not make it throw up
          if(!user) this.throw(404)
          this.body = user
        })

      .put('/users/:user', jsonBody(), function*(next) {
          var params = Object.create(this.params)
          params.data = this.request.body
          if(!(yield auth.authorize(this.user, 'user:write', params))) {
            return this.throw(403)
          }
          yield User.update({id: this.params.user}, this.request.body)
          this.body = yield User.findOne({id: this.params.user})
        })
      .delete('/users/:user', function * (next) {
          if(!(yield auth.authorize(this.user, 'user:destroy', this.params))) {
            return this.throw(403)
          }
          var user = yield User.findOne({id:this.params.user})
          if(!user) this.throw(404)
          yield user.destroy()
          this.body = {message: 'ok'}
        })

      .get('/users/:user/documents', function*(next) {
          if(!(yield auth.authorize(this.user, 'user/documents:index', this.params))) {
            return this.throw(403)
          }
          var docs = yield Document.find({where: {authors: this.params.user}})
          if(docs) this.body = docs
          else this.body = []
        })

      .get('/users/:user/snapshots', function * () {
          if(!(yield auth.authorize(this.user, 'user/snapshots:index', this.params))) {
            return this.throw(403)
          }
          var snapshot = yield Snapshot.find({where: {author: this.params.user}})

          if(!snapshot) this.throw(404)
          this.body = snapshot
        })

      .get('/snapshots/:snapshot', function * () {
          if(!(yield auth.authorize(this.user, 'snapshot:show', this.params))) {
            return this.throw(403)
          }
          var snapshot = yield Snapshot.findOne({id:this.params.snapshot}) // XXX: Might require Document.exists() beforehand to not make it throw up
          if(!snapshot) this.throw(404)
          this.body = snapshot
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
