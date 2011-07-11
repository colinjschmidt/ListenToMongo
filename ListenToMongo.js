/**
 * Listen to Mongo
 * 
 * A node-mongobd-native wrapper with event listeners supporting query chaining and buffering
 * 
 * Requires node-mongodb-native by christkv - https://github.com/christkv/node-mongodb-native
 * 
 * @author Colin J Schmidt
 * @version 1.0
 * @date 07/10/2011
 */

var mongodb = require('mongodb');
var EventEmitter = require('events').EventEmitter;


/**
 * Constructor for MongoDb Wrapper
 * 
 * @param string database - The name of the mongodb database
 * @param string host - The host for the mongodb database
 * @param string port - The port for the mongodb database
 * @param object options -The options used to connect to the mongodb
 */
var MongoDb = function (database, host, port, options) {
  
  var mongoDb = this;
  var mongo;
  var isConnected = false;
  var isConnecting = false;
  
  // The name of the db connection event 
  var dbConnectEventName = 'mongodb_connected';
  
  /**
   * Returns a 'unique' ID for the transaction
   * @return string - a pretend uuid
   */
  var getTransactionId = function () {
    var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
    
    return uuid;
  };
  
  
  /**
   * Opens a connection to the mongodb database
   */
  var connect = function () {
    
    isConnecting = true;
    
    new mongodb.Db(database, new mongodb.Server(host, port, {auto_reconnect:true}), options)
      .open(function (err, db) {

        if (err) {
          throw 'Mongo DB Error: ' + err;
        }
         
        // Store the db connection in a private member variable to be used later
        mongo = db;
        isConnected = true;
        isConnecting = false;
        
        // Emit the connected event and remove event listeners
        mongoDb.emit(dbConnectEventName, db);
        mongoDb.removeAllListeners(dbConnectEventName);
      });
  };
  
  
  /**
   * Constructor function for mongo db object, all share a common connection
   * 
   * @param string required_txn_id (optional) - the unique id for the previous transaction
   * @param bool event (optional) - true if query spawned from an event listener
   * @param string override_txn_id(optional) - the unique txn id to use for this query
   * @return object - New db object
   */
  var db = function (required_txn_id, event, override_txn_id) {
    
    // setup a local reference to this
    var thisDb = this;
    
    // Get a unique transaction id for this query
    var txn_id = (typeof override_txn_id !== 'undefined') ? override_txn_id : getTransactionId();
    
    // Is this method chained (dependent) on a previous query
    var isChained = (typeof required_txn_id !== 'undefined' && !event);
    
    var dbQueryEventName = 'mongodb_query_complete_' + txn_id;
    
    /**
     * Adds an event handler to the query completion event listener,
     * Used to chain queries together
     * 
     * @param string txn_id - the unique transaction id for this query
     * @param string method - the mongodb method (find, insert, update, remove)
     * @param object args - all of the arguments passed to the original query
     * @return object - new db object with txn id of previous transaction
     */
    var chainQuery = function (txn_id, method, args) {
      mongoDb.addListener(dbQueryEventName, function(last_txn_id, err, docs) {
        // If the required query is the one that finished, run the dependent query
          (new db(required_txn_id, true, txn_id))[method].apply(this, args);
      });
      return new db(txn_id);
    };
    
    
    /**
     * Adds an event handler to the database connection event listener,
     * Used to delay query exececution until db connects
     * 
     * @param string txn_id - the unique transaction id for this query
     * @param string method - the mongodb method (find, insert, update, remove)
     * @param object args - all of the arguments passed to the original query
     * @return object - new db object with txn id of previous transaction
     */
    var connectQuery = function (txn_id, method, args) {
      
      mongoDb.addListener(dbConnectEventName, function(){
        (new db(required_txn_id, true, txn_id))[method].apply(this, args);
      });
      
      if (!isConnecting) { 
        connect(); 
      }
      return new db(txn_id);
    };
    
    
    /**
     * Binds a callback function to the query complete event listener
     * 
     * @param function callback - The callback to execute when the query finishes
     */
    var attachCallback = function (callback) {
      
      if (typeof callback === 'function' && !event) {
        // This query has a callback, so add a specific event listener to this query using its transaction id
        mongoDb.addListener(dbQueryEventName, function(complete_txn_id, err, docs){
          callback(err, docs);
        });
      }
    };
    
    
    /**
     * Finds data from a specified collection, based on the query params
     * 
     * @param string collection - name of a collection in the connected db
     * @param object query_params - mongodb style query param object
     * @param object fields - the fields to return from the query
     * @param object options - mongodb query options
     * @return object - new db object with txn id of previous transaction
     */
    this.find = function(collection, query_params, fields, options, callback) {
      
      var method = 'find';
      
      callback = (typeof arguments[arguments.length - 1] === 'function') ? arguments[arguments.length - 1] : null;
      
      if (callback) {
        attachCallback(callback);
      }
      
      if (isChained) {
        // This is a chained query 
        // so add the appropriate event handler and return a new db instance
        return chainQuery(txn_id, method, arguments);
      }
      
      if (!isConnected) {
        // The db hasn't connected yet
        // so add the appropriate event handler and return a new db instance
        return connectQuery(txn_id, method, arguments);
      }
      
      if (typeof query_params === 'object' && typeof query_params._id === 'string') {
        query_params._id = new mongo.bson_serializer.ObjectID(query_params._id);
      }
      
      // Go through the normal mongo db native calls to find data and emit the data as an array
      mongo.collection(collection, function(err, collection) {
        collection.find(query_params, fields, options).toArray(function(err, docs) {
          mongoDb.emit(dbQueryEventName, txn_id, err, docs);
          mongoDb.removeAllListeners(dbQueryEventName);
        });
      });

      // Return a new instance of the db with the txn id set
      return new db(txn_id);
    };
    
    
    /**
     * Inserts a document into the specified collection
     * 
     * @param string collection - name of a collection in the connected db
     * @param array docs - an array of documents to insert into the db
     * @param object options - mongodb query options
     * @param function callback - a function to invoke once the query returns
     * @return object - new db object with txn id of previous transaction
     */
    this.insert = function (collection, docs, options, callback) {
      
      var method = 'insert';
      
      callback = (typeof arguments[arguments.length - 1] === 'function') ? arguments[arguments.length - 1] : null;
      
      if (callback) {
        attachCallback(callback);
      }
      
      if (isChained) {
        // This is a chained query 
        // so add the appropriate event handler and return a new db instance
        return chainQuery(txn_id, method, arguments);
      }
      
      if (!isConnected) {
        // The db hasn't connected yet 
        // so add the appropriate event handler and return a new db instance
        return connectQuery(txn_id, method, arguments);
      }
      
      // Go through the normal mongo db native calls to insert data
      mongo.collection(collection, function(err, collection) {
        
       // setup query options to atleast use safe = true
       if (typeof options !== 'object') {
          options = {
            safe : true
          };
        }
        
        // perform the insert and emit the complete event
        collection.insert(docs, options, function(err, objects) {
          if (err) {console.log(err.message);}
          mongoDb.emit(dbQueryEventName, txn_id, err, objects);
          mongoDb.removeAllListeners(dbQueryEventName);
        });
      });

      // Return a new instance of the db with the txn id set
      return new db(txn_id);
    };
    
    
    /**
     * Updates a document in the specified collection
     * 
     * @param string collection - name of a collection in the connected db
     * @param object query_params - mongodb style query param object
     * @param object updates - The updates to apply to the matched documents
     * @param object options - mongodb query options
     * @param function callback - a function to invoke once the query returns
     * @return object - new db object with txn id of previous transaction
     */
    this.update = function (collection, query_params, updates, options, callback) {
      
      var method = 'update';
      var thisCollection = collection;
      
      callback = (typeof arguments[arguments.length - 1] === 'function') ? arguments[arguments.length - 1] : null;
      
      if (callback) {
        attachCallback(callback);
      }
      
      if (isChained) {
        // This is a chained query 
        // so add the appropriate event handler and return a new db instance
        return chainQuery(txn_id, method, arguments);
      }
      
      if (!isConnected) {
        // The db hasn't connected yet 
        // so add the appropriate event handler and return a new db instance
        return connectQuery(txn_id, method, arguments);
      }
      
      // Go through the normal mongo db native calls to update data
      mongo.collection(collection, function(err, collection) {
        
        // setup default query options, if none specified
        if (typeof options !== 'object') {
          options = {
            safe : true
          };
        }
                
        if (typeof query_params === 'object' && typeof query_params._id === 'string') {
          query_params._id = new mongo.bson_serializer.ObjectID(query_params._id);
        }
        
        if (updates._id) {
          delete(updates._id);  
        }
        
        // perform the update and emit the complete event
        collection.update(query_params, {$set: updates}, options, function(err) {
          if (err) {console.log(err.message);}
          (new db()).find(thisCollection, query_params, {}, {}, function (err, docs) {
            mongoDb.emit(dbQueryEventName, txn_id, err, docs);
            mongoDb.removeAllListeners(dbQueryEventName);
          });
        });
      });
      
      // Return a new instance of the db with the txn id set
      return new db(txn_id);
    };
    
    
    /**
     * Removes documents from the specified collection
     * 
     * @param string collection - name of a collection in the connected db
     * @param object query_params - mongodb style query param object
     * @param function callback - a function to invoke once the query returns
     * @return object - new db object with txn id of previous transaction
     */
    this.remove = function (collection, query_params, callback) {
      
      var method = 'remove';
      
      callback = (typeof arguments[arguments.length - 1] === 'function') ? arguments[arguments.length - 1] : null;
      
      if (callback) {
        attachCallback(callback);
      }
      
      if (isChained) {
        // This is a chained query 
        // so add the appropriate event handler and return a new db instance
        return chainQuery(txn_id, method, arguments);
      }
      
      if (!isConnected) {
        // The db hasn't connected yet 
        // so add the appropriate event handler and return a new db instance
        return connectQuery(txn_id, method, arguments);
      }
      
      // Go through the normal mongo db native calls to remove data
      mongo.collection(collection, function(err, collection) {
                
        if (err) {
          console.log(err);
        }
        
        // setup default query options, if none specified
        if (typeof options !== 'object') {
          options = {
            safe : true
          };
        }
        
        if (typeof query_params === 'object' && typeof query_params._id === 'string') {
          query_params._id = new mongo.bson_serializer.ObjectID(query_params._id);
        }
                
        // perform the removal and emit the complete event
        collection.remove(query_params, options, function (err) {
          if (err) {console.log(err.message);}
          mongoDb.emit(dbQueryEventName, txn_id, err);
          mongoDb.removeAllListeners(dbQueryEventName);
        });
      });
      
      // Return a new instance of the db with the txn id set
      return new db(txn_id);
    };
  };
  
  return new db();
};

MongoDb.prototype = new EventEmitter();

module.exports = MongoDb;
