// See https://github.com/alexmingoia/koa-resource-router
var koa = require('koa')
  , mount = require('koa-mount')
  , router = require('koa-router')
  , jsonBody = require('koa-parse-json');

module.exports = setup
module.exports.consumes = ['http', 'orm', 'auth']

function setup(plugin, imports, register) {
  var httpApp = imports.http
    , orm = imports.orm
    , auth = imports.auth

  var api = koa()
  httpApp.use(mount('/api', api))

  api.use(jsonBody())

  var APIv1 = koa()
  api.use(mount('/v1', APIv1))
  APIv1.use(router(APIv1))

  var Document = orm.collections.document
    , Snapshot = orm.collections.snapshot
    , User = orm.collections.user
    , PendingChange = orm.collections.pendingChange

  var authenticate = function*(next) {
    this.user = yield auth.authenticate('oauth', this.request.query.token) //XXX: good idea?
    yield next
  }

  APIv1
    .post('/documents', authenticate, function*(next) {
        if(!this.accepts('json')) {
         return this.throw(406)
        }
        if(!yield auth.authorize(this.user, 'document:create', this.params)) {
         return this.throw(403)
        }
        var doc = yield Document.create({
          type: this.body.type
        })
        yield Snapshot.createInitial(doc.id) // XXX
      })
    .get('/documents/:document', authenticate, function * (next) {
        if(!yield auth.authorize(this.user, 'document:show', this.params)) {
          return this.throw(403)
        }
        try {
          return yield Document.findOne(this.params.document) // XXX: Might require Document.exists() beforehand to not make it throw up
        }catch(e){
          e.status = 404
          throw e
          yield next
        }
      })
    .delete('/documents/:document', authenticate, function * (next) {
        if(!yield auth.authorize(this.user, 'document:destroy'. this.params)) {
          return this.throw(403)
        }
        try {
          return ( yield Document.findOne(this.params.document) ).destroy()
        }catch(e){
          this.status = 404
          yield next
        }
      })

    .post('/documents/:document/pendingChanges', authenticate, function * (next) {
        if(!yield auth.authorize(this.user, 'document/pendingChanges:create', this.params)) {
          return this.throw(403)
        }
        if(!this.accepts('json')) {
         return this.throw(406)
        }
        var doc = yield Document.findOne(this.params.document) // XXX: 404

        yield doc.pendingChanges.add({
         changes: this.request.body.changes
        , parent: this.request.body.parent
        , user: this.request.body.user // XXX: What if I'm admin and req.body.user != this.user
        })
      })

    .get('/documents/:document/users', authenticate, function * (next) {
        if(!yield auth.authorize(this.user, 'document/users:index', this.params)) {
          return this.throw(403)
        }
        var doc = yield Document.findOne(this.params.document)
        this.body = doc.users
      })

    .get('/documents/:document/snapshots', authenticate, function * (next) {
        if(!yield auth.authorize(this.user, 'document/snapshots:index', this.params)) {
          return this.throw(403)
        }
        var doc = yield Document.findOne(this.params.document)
        this.body = doc.snapshots
      })

    .post('/users', authenticate, function*(next) {
        if(!this.accepts('json')) {
        return this.throw(406)
        }
        if(!yield auth.authorize(this.user, 'user:create', this.params)) {
        return this.throw(403)
        }
        var doc = yield User.create({
          name: this.body.name
        , type: this.body.type
        , foreignId: this.body.foreignId
        })
        yield Snapshot.createInitial(doc.id) // XXX
      })
    .get('/users/:user', authenticate, function*(next) {
        if(!yield auth.authorize(this.user, 'user:show', this.params)) {
          return this.throw(403)
        }
        try {
          return yield User.findOne(this.params.document) // XXX: Might require Document.exists() beforehand to not make it throw up
        }catch(e){
          e.status = 404
          throw e
          yield next
        }
      })

    .put('/users/:user', authenticate, function*(next) {
        // XXX
      })
    .delete('/users/:user', authenticate, function * (next) {
        if(!yield auth.authorize(this.user, 'user:destroy', this.params)) {
          return this.throw(403)
        }
        return ( yield User.find(this.params.user) ).destroy()
      })

    .get('/users/:user/documents', authenticate, function*(next) {
        if(!yield auth.authorize(this.user, 'user/documents:index', this.params)) {
          return this.throw(403)
        }
        this.body = yield Document.find({where: {authors: this.params.user}})
      })

    .get('/users/:user/snapshots', authenticate, function * () {
        if(!yield auth.authorize(this.user, 'user/snapshots:index', this.params)) {
          return this.throw(403)
        }
        this.body = yield Snapshot.find({where: {author: this.params.user}})
      })

    .get('/snapshots/:snapshot', authenticate, function * () {
        if(!yield auth.authorize(this.user, 'snapshot:show', this.params)) {
          return this.throw(403)
        }
        try {
          return yield Snapshot.findOne(this.params.snapshot) // XXX: Might require Document.exists() beforehand to not make it throw up
        }catch(e){
          e.status = 404
          throw e
          yield next
        }
      })


  register()
}
