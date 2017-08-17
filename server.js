var fs = require('fs');
var express = require('express');
var parser = require('ua-parser');
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
var mongodb = require('mongodb');
var app = express();

var results, dbURL, url, requestedURL, searchRequest, offset, snippet, thumbnail, context, responseText, searchHistory;

var mongoClient = mongodb.MongoClient;
// Need to do this later, before pushign to Github: https://forum.freecodecamp.org/t/storing-mongo-username-password-persistently-using-dotenv/50994
var dbURL = "mongodb://" + process.env.MONGOUSERNAME + ":" + process.env.MONGOPASSWORD + "@ds151450.mlab.com:51450/imagesearch";


if (!process.env.DISABLE_XORIGIN) {
  app.use(function(req, res, next) {
    var allowedOrigins = ['https://narrow-plane.gomix.me', 'https://www.freecodecamp.com'];
    var origin = req.headers.origin || '*';
    if(!process.env.XORIG_RESTRICT || allowedOrigins.indexOf(origin) > -1){
         //console.log(origin);
         res.setHeader('Access-Control-Allow-Origin', origin);
         res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    }
    next();
  });
}

app.use('/public', express.static(process.cwd() + '/public'));

app.route('/_api/package.json')
  .get(function(req, res, next) {
    //console.log('requested');
    fs.readFile(__dirname + '/package.json', function(err, data) {
      if(err) return next(err);
      res.type('txt').send(data.toString());
    });
  });
  
app.route('/')
    .get(function(req, res) {
      res.sendFile(process.cwd() + '/views/index.html');
    })

//Google search API documentation: https://developers.google.com/custom-search/json-api/v1/using_rest
//https://www.googleapis.com/customsearch/v1?key=AIzaSyBXYH92vaeLNDvyD_J4tB881h8x8AswCsw&cx=000627867005206011991:3yixxoazlug&q=cats&searchtype=images

// This works pretty well but two issues: 1) Sometimes Google returns less than the desired number of results, as specified by the offset.
// In this case the below code uses the number of returned items for the for loop.  2) There appears to be a maximum of 10 results 
app.route("/api/imagesearch/:search").get(function(req, res) {
  console.log(req.params);
  console.log(req.query);
  requestedURL = req.url.replace("/imagesearch/","");
  searchRequest = req.params.search;
  offset = req.query.offset;
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "https://www.googleapis.com/customsearch/v1?key=AIzaSyBXYH92vaeLNDvyD_J4tB881h8x8AswCsw&cx=000627867005206011991:3yixxoazlug&q="+searchRequest+"&searchtype=images&num="+offset, false);
  // Add your code below!
  xhr.send();

  responseText = JSON.parse(xhr.responseText);
  console.log('Num of items: ' + responseText.items.length + ' search request:  ' + searchRequest);
  
  // log the request to the database
  insertToDB(searchRequest);
  
  setTimeout(function(){
    results = [];
    
    for (var i = 0; i < responseText.items.length; i++){
      // gets the required response items from the respone
      snippet = responseText.items[i].title;
      context = responseText.items[i].link;
      
      // some results I got from Google were financial quotes with different JSON structure
      if (responseText.items[i].pagemap.financialquote){
        url = responseText.items[i].pagemap.financialquote[0].url;
        thumbnail = responseText.items[i].pagemap.financialquote[0].imageurl;
      } else if (responseText.items[i].pagemap.cse_image && responseText.items[i].pagemap.cse_thumbnail) {
        url = responseText.items[i].pagemap.cse_image[0].src;
        thumbnail = responseText.items[i].pagemap.cse_thumbnail[0].src;
      } else {
        url = "";
        thumbnail = "";
      };
      
      
    // object to hold details of each result item.  Pushed to the results array when done  
    var thisItemsResults = {
      "search request": req.params.search,
      "offset": req.query.offset,
      "url": url,
      "snippet": snippet,
      "thumbnail": thumbnail,
      "context": context
      };
      results.push(thisItemsResults);
    }
    // returns the resuls array as JSON
    res.json(results);
    
  }, 500);
  
});

app.route("/api/latest/imagesearch").get(function(req, res) {
  
  // retrieves the search history from the database
  searchHistory = returnResultsFromDB(); 
  
  // pauses 100 milliseconds to give the data a chance to lookup - would be better to do this with a callback? promise? something to learn more about
    setTimeout(function(){
      res.json(searchHistory); 
    }, 100);
  
  });


    
// Respond not found to all the wrong routes
app.use(function(req, res, next){
  results = { 
        "error": "Incorrectly formatted URL or unknown site."
        };
      res.json(results);   
  res.status(404);
});

// Error Middleware
app.use(function(err, req, res, next) {
  if(err) {
    res.status(err.status || 500)
      .type('txt')
      .send(err.message || 'SERVER ERROR');
  }  
})


app.listen(process.env.PORT, function () {
  console.log('Node.js listening ...');
});

// function to connect to mongoDB and insert the record to the urls collection
function insertToDB(searchTerm){
  // connects to db
  mongoClient.connect(dbURL, function (err, db) {
  if (err) {
    console.log('Unable to connect to the mongoDB server. Error:', err);
  } else {
    console.log('Connection established');

    var collection = db.collection('searchHistory');
    var timestamp = new Date().toUTCString();
    
    
    // inserts object to the database
    collection.insert({
      term: searchTerm,
      when: timestamp
    }, function(err, data) {
      if (err) {
      console.log('Unable to insert the document. Error: ', err);
      } else {
        console.log('successfully inserted document');
      }
    })

    //Close connection
    db.close();
      }
  });
}

// function to find and return all records in the database collection
function returnResultsFromDB(){
  // array to hold the results
  var tempArr = [];
  
  // connect to mongoDB
  mongoClient.connect(dbURL, function (err, db) {
  if (err) {
    console.log('Unable to connect to the mongoDB server. Error:', err);
  } else {
    console.log('Connection established');
    
    var collection = db.collection('searchHistory');
    
    // find without paramaters returns all results
    collection.find({}).toArray(function(err, documents) {
      
      if (err) {
      console.log('Unable to perform find request. Error: ', err);
      } else {
        if (documents.length > 0){
          
          console.log('Successfully found the documents. Number of documents is: ' + documents.length);
          
          // creates a temp object for each item and pushes it to the temp array 
          documents.forEach(function(item){
              var temp = {
                "term": item.term,
                "when": item.when
              };
              tempArr.push(temp);  
            });
          
          } else {
          console.log('Documents not found');
        }
      }
    })

    //Close connection
    db.close();
      }
  });
  return tempArr;
}