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
var request = require('supertest')
  , assert = require('assert')
  , request = request('http://localhost:1235/api/v1')
  , API_key = 'xxx'


describe('Users API', function() {
  var userId

  it('should create a new user', function(done) {
    request
    .post('/users')
    .set('Authorization', 'token '+API_key)
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
    .set('Authorization', 'token '+API_key)
    .expect(200)
    .expect('Content-Type', /json/)
    .expect(function(res) {
      assert(res.body.id == userId)
    })
    .end(done)
  })

  it('should update a user', function(done) {
    request
    .put('/users/'+userId)
    .set('Authorization', 'token '+API_key)
    .send({name: 'baz'})
    .expect(200)
    .expect('Content-Type', /json/)
    .end(function(err, res) {
      if(err) return done(err)
      expect(res.body.name).to.equal('baz')
      done()
    })
  })

  it('should delete a user', function(done) {
    request
    .delete('/users/'+userId)
    .set('Authorization', 'token '+API_key)
    .expect(200)
    .expect('Content-Type', /json/)

    .end(function(err) {
      if(err) return done(err)

      request
      .get('/users/'+userId)
      .set('Authorization', 'token '+API_key)
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
      .set('Authorization', 'token '+API_key)
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
    .set('Authorization', 'token '+API_key)
    .send({type: 'plaintext'})
    .expect(200)
    .expect('Content-Type', /json/)
    .end(function(err, res) {
      if(err) return done(err)
      documentId = res.body.id
      done()
    })
  })

  var document
  it('should retrieve a document', function(done) {
    request
    .get('/documents/'+documentId)
    .set('Authorization', 'token '+API_key)
    .expect(200)
    .expect('Content-Type', /json/)
    .expect(function(res) {
      assert(res.body.id == documentId)
      document = res.body
    })
    .end(done)
  })

  var snapshot
  it('should change a document', function(done) {
    request
    .post('/documents/'+documentId+'/pendingChanges')
    .set('Authorization', 'token '+API_key)
    .send({changes: ["foo"], parent: document.latestSnapshot, user: userId})
    .expect(200)
    .expect('Content-Type', /json/)
    .expect(function(res) {
      assert(res.body.contents == 'foo')
      snapshot = res.body
    })
    .end(function(err) {
      if(err) return done(err)

      request
      .get('/documents/'+documentId)
      .set('Authorization', 'token '+API_key)
      .expect(200)
      .expect('Content-Type', /json/)
      .expect(function(res) {
        assert(res.body.latestSnapshot == snapshot.id)
      })
      .end(done)
    })
  })

  it('should delete a document', function(done) {
    request
    .delete('/documents/'+documentId)
    .set('Authorization', 'token '+API_key)
    .expect(200)
    .expect('Content-Type', /json/)

    .end(function(err) {
      if(err) return done(err)

      request
      .get('/documents/'+documentId)
      .set('Authorization', 'token '+API_key)
      .expect(404)
      .expect('Content-Type', /json/)
      .end(done)
    })
  })
})
