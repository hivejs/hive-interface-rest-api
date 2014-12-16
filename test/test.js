var request = require('supertest')
  , assert = require('assert')
  , request = request('http://localhost:1235/api/v1')
  , API_key = 'xxx'


describe('Users API', function() {
  var userId

  it('should create a new user', function(done) {
    request
    .post('/users')
    .set('X-API-Key', API_key)
    .send({name: 'Foo Bar'/*, type: '', foreignId: 1234*/})
    .expect(200)
    .expect('Content-Type', /json/)
    .end(function(err, res) {
      if(err) return done(err)
      userId = res.body.id
      done()
    })
  })

  it('should retrieve a user', function(done) {
    request
    .get('/users/'+userId)
    .set('X-API-Key', API_key)
    .expect(200)
    .expect('Content-Type', /json/)
    .expect(function(res) {
      assert(res.body.id == userId)
    })
    .end(done)
  })

  it('should delete a user', function(done) {
    request
    .delete('/users/'+userId)
    .set('X-API-Key', API_key)
    .expect(200)
    .expect('Content-Type', /json/)

    .end(function(err) {
      if(err) return done(err)

      request
      .get('/users/'+userId)
      .set('X-API-Key', API_key)
      .expect(404)
      .expect('Content-Type', /json/)
      .end(done)
    })
  })

})

describe('Documents API', function() {

  var userId
  before(function(done) {
    // create a new user
    request
      .post('/users')
      .set('X-API-Key', API_key)
      .send({name: 'Foo Bar'/*, type: '', foreignId: 1234*/})
      .end(function(err, res) {
        if(err) return done(err)
        userId = res.body.id
        done()
      })
  })

  var documentId

  it('should create a new document', function(done) {
    request
    .post('/documents')
    .set('X-API-Key', API_key)
    .send({type: 'text'})
    .expect(200)
    .expect('Content-Type', /json/)
    .end(function(err, res) {
      if(err) return done(err)
      documentId = res.body.id
      done()
    })
  })

  it('should retrieve a document', function(done) {
    request
    .get('/documents/'+documentId)
    .set('X-API-Key', API_key)
    .expect(200)
    .expect('Content-Type', /json/)
    .expect(function(res) {
      assert(res.body.id == documentId)
    })
    .end(done)
  })

  it('should change a document', function(done) {
    request
    .post('/documents/'+documentId+'/pendingChanges')
    .set('X-API-Key', API_key)
    .send({changes: '+foo', parent: 0, user: userId})
    .expect(200)
    .expect('Content-Type', /json/)
    .expect(function(res) {
      assert(res.body.id == documentId)
    })
    .end(done)
  })

  it('should delete a document', function(done) {
    request
    .delete('/documents/'+documentId)
    .set('X-API-Key', API_key)
    .expect(200)
    .expect('Content-Type', /json/)

    .end(function(err) {
      if(err) return done(err)

      request
      .get('/documents/'+documentId)
      .set('X-API-Key', API_key)
      .expect(404)
      .expect('Content-Type', /json/)
      .end(done)
    })
  })
})
