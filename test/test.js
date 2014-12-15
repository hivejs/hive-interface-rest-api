var request = require('supertest')
  , assert = require('assert')
  , API_key = 'xxx'


describe('API version 1', function() {
  request = request('http://localhost:1235/api/v1')

  var userId

  it('should create a new user', function(done) {
    request
    .post('/users')
    .set('X-API-Key', API_key)
    .send({name: 'Foo Bar', type: '', foreignId: 1234})
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

  it('should delete a document', function(done) {
    request
    .delete('/documents/'+documentId)
    .set('X-API-Key', API_key)
    .expect(200)
    .expect('Content-Type', /json/)

    .end(function(err) {
      if(err) return done(err)

      request
      .get('/documents/'+userId)
      .set('X-API-Key', API_key)
      .expect(404)
      .expect('Content-Type', /json/)
      .end(done)
    })
  })
})
