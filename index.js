"use strict";
var koa = require('koa')
  , mount = require('koa-mount')
  , router = require('koa-router')
  , jsonBody = require('koa-parse-json');

module.exports = setup
module.exports.consumes = ['http', 'auth', 'hooks', 'orm', 'sync', 'ot']

function setup(plugin, imports, register) {
  var httpApp = imports.http
    , auth = imports.auth
    , hooks = imports.hooks
    , orm = imports.orm
    , sync = imports.sync
    , ot = imports.ot

  var api = koa()
  httpApp.use(mount('/api', api))

  var APIv1 = koa()
  api.use(mount('/v1', APIv1))

  APIv1.use(jsonBody())

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
    var token = this.request.query.access_token
    if(!token) {
      token = this.get('Authorization')
      if(!token) return this.throw(401)
      var tokenParts = token.split(' ')
      if(tokenParts[0] !== 'token') return this.throw(401)
      token = tokenParts[1]
    }
    this.user = yield auth.authenticate('oauth', token)
    if(!this.user) {
      return this.throw(401)
    }
    yield next
  })

  APIv1.use(router(APIv1))

  hooks.on('models:loaded', function*(models){

    var Document = models.Document
      , Snapshot = models.Snapshot
      , User = models.User

    APIv1
      .post('/documents', function*(next) {
          if(!this.accepts('json')) {
           return this.throw(406)
          }
          if(!(yield auth.authorize(this.user, 'document:create', this.params))) {
           return this.throw(403)
          }

          var ottype = ot.getOTType(this.request.body.type)
          if(!ottype) this.throw(400, 'Specified document type is not available')

          var doc = yield Document.create({
            type: this.request.body.type
          })

          var content = ottype.create()
          if(ottype.serialize) {
            content = ottype.serialize(content)
          }

          var snapshot = yield Snapshot.create({
            content: content
          , document: doc.id
          , author: this.user.id
          })

          doc.snapshot = snapshot.id
          yield doc.save()

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
      .delete('/documents/:document', function * (next) {
          if(!(yield auth.authorize(this.user, 'document:destroy', this.params))) {
            return this.throw(403)
          }

          var doc = yield Document.findOne({id: this.params.document})
          if(!doc) this.throw(404)
          yield doc.destroy() // XXX: Remove all snapshots
          this.body = {message: 'ok'}
        })

      .post('/documents/:document/pendingChanges', function * (next) {
          if(!(yield auth.authorize(this.user, 'document/pendingChanges:create', this.params))) {
            return this.throw(403)
          }
          if(!this.accepts('json')) {
           return this.throw(406)
          }
          var doc = yield Document.findOne({id: this.params.document}) // XXX: 404
          if(!doc) this.throw(404)

          this.body = yield function(cb) {
            sync.getDocument(doc.id).receiveEdit(JSON.stringify({
              changeset: this.request.body.changes
            , parent: this.request.body.parent
            , user: this.request.body.user // XXX: What if I'm admin and req.body.user != this.user
            }), cb)
          }
        })

      .get('/documents/:document/users', function * (next) {
          if(!(yield auth.authorize(this.user, 'document/users:index', this.params))) {
            return this.throw(403)
          }
          var doc = yield Document.findOne({id: this.params.document})
          this.body = doc.users
        })

      .get('/documents/:document/snapshots', function * (next) {
          if(!(yield auth.authorize(this.user, 'document/snapshots:index', this.params))) {
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

      .post('/users', function*(next) {
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
          yield user.save()
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

      .put('/users/:user', function*(next) {
          // XXX
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
  })

  register()
}
