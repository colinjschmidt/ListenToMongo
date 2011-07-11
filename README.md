# ListenToMongo

A node-mongobd-native wrapper with event listeners supporting query chaining and buffering

## Overview

ListenToMongo was initially written to avoid the deeply nested callbacks that are easy to write when using node-mongodb-native directly.  It is supposed to be a light-weight wrapper, such that each database method takes the same arguments as the underlying node driver.  ListenToMongo extends the native node.js event emitter object for query buffering and chaining.

## Benefits

- Uses a single database connection for all queries
- Buffers all queries until database connection is established
- Simplifies syntax by removing several layers of nested callbacks
- Supports query chaining through both callbacks and dot notation
- Passes array of results to callback functions, even on update

## Limitations

- Currently only supports find, insert, update, remove
- Only additional queries can be chained, however callback functions are supported
- Currently connection event is only fired on first connection, not on reconnects
- Unit tests still in progress!

## Examples

### Connecting to MongoDb

    var DB = new MongoDb(database, host, port, options);
    
### Single Query (Find All)

    var DB = new MongoDb('myDatabase', '127.0.0.1', 27017);
    
    DB.find('myCollection', function(err, docs) {
      
      if (err) { console.log(err); }
    
      docs.forEach(function(doc) {
        console.log(doc);
      });
    });
    
### Chained Query (Insert and Find All)

  var DB = new MongoDb('myDatabase', '127.0.0.1', 27017);
  
  var collection = 'myCollection';
  var doc = {a:1};
  
  DB.insert(collection, doc).find(collection, function(err, docs) {
    
    if (err) { console.log(err); }
  
    docs.forEach(function(doc) {
      console.log(doc);
    });
  });