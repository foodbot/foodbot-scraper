var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var _ = require('underscore');
var pmongo = require('promised-mongo');
var db = pmongo('mongodb://localhost:27017/feedme', ["facebook", "facebookTokens"]);

var googleApiKey = process.env.GOOGLEAPIKEY || "123FAKEKEY";
var radius = "7000"; //in meters
var targetAddress = "San Francisco";
var tokens = [];
var insertCount = 0;
var locationNames = [];
var eventIds = [];
var events = [];
//need to manually terminate program when scraping complete, since db connection is always open
var terminateProgram = function(){
  console.log("Program finished,", insertCount, "entries added / updated");
  process.exit(1);
};
var getAllTokens = function(){
  return db.facebookTokens.find().toArray()
  .then(function(items){
    tokens = items;
    return tokens;
  });
};
var getRandomToken = function(){
  var index = Math.floor(tokens.length * Math.random());
  return tokens[index];
};
//gets all events at the location and adds id to eventIds
var getEventIdsByLocationName = function(name, index){
  var url = "https://graph.facebook.com/search?q="+name+"&type=event&access_token="+getRandomToken();
  // console.log("GET:", url);
  return request.getAsync(url)
  .spread(function(res, body){
    body = JSON.parse(body);
    if(!body.data){
      console.log(JSON.stringify(body));
      return null;
      // throw "getEventIdsByLocationName - "+ JSON.stringify(body);
    }
    console.log("getEventIdsByLocationName["+index+"] - found", body.data.length, "event ids");
    eventIds = eventIds.concat(_.pluck(body.data, "id"));
  });
};
//recursive function that pulls down "places" data from facebook, and recursively getting any paginated data
var getPlaces = function(apiURL, recursiveCount, finishCallback){
  var nextUrl;
  if(recursiveCount === undefined){
     recursiveCount = 99999;
  }

  console.log("Trying to get location results from:", apiURL);
  request.getAsync(apiURL)
  .spread(function(res, body){
    body = JSON.parse(body);
    var results = body.data;
    // console.log(body);
    body.paging = body.paging || {};
    nextUrl = body.paging.next; //never works, limited to 450

    if(results){
      console.log("Results length:", results.length);
      return results;
    }else{
      throw "getPlaces - "+JSON.stringify(body);
    }
  })
  .then(function (results){
    locationNames = locationNames.concat(_.pluck(results, "name"));
    return results;
  })
  .then(function (results){
    if(recursiveCount > 1 && nextUrl){
      getPlaces(nextUrl,recursiveCount-1, finishCallback);
    }else{
      console.log("Total location Names:", locationNames.length);
      finishCallback(locationNames);
    }
  })
  .catch(function(err){
    console.log("ERR:", err);
    terminateProgram();
  });
};
var getPlacesAsync = function(apiURL, recursiveCount){
  return new Promise(function(resolve,reject){
    getPlaces(apiURL, recursiveCount, resolve);
  });
};
var getPlacesAtLocation = function(lat,lon){
  var url = "https://graph.facebook.com/search?q=a&type=place&center="+lat+","+lon+"&distance="+radius+"&access_token="+getRandomToken();
  return getPlacesAsync(url, 1);
};
//takes an array of event id, then builds the giant FQL query url. Can take upto 2000 event id's at a time.
var getEvents = function(ids){
  var eids = _.map(ids, function(id){
     return "eid = "+id; 
  });
  eids = eids.join(" OR ");

  // console.log("EIDS:", eids);
  var url = "https://graph.facebook.com/fql?q=SELECT name,description,attending_count,eid,start_time,end_time,location,venue,ticket_uri FROM event WHERE "+eids+"&access_token="+getRandomToken();
  
  return request.getAsync(url)
  .spread(function(res, body){
    body = JSON.parse(body);
    if(!body.data){
      throw "getEvents - "+JSON.stringify(body);
    }
    body.data = body.data || [];
    
    events = events.concat(body.data);
    console.log("Received Events:", body.data.length);
    return body.data;
  });
};
//splits arrays into smaller arrays based on targetLength, returns an array of arrays
var arraySplit = function(array, targetLength){
  var arrayNum = Math.ceil(array.length/targetLength);
  var superArray = [];
  for(var i = 0; i < arrayNum; i++){
    superArray.push(array.slice(0+targetLength*i, targetLength*(i+1)));
  }
  return superArray;
};
//promise that fetches the access token from facebook, returns cached token if avaliable
// var getAccessToken = function(){
//   if (facebookToken){
//     return Promise.join().then(function(){
//       return facebookToken;
//     });
//   }else{
//     return request.getAsync("https://graph.facebook.com/oauth/access_token?grant_type=client_credentials&client_id="+facebookAppId+"&client_secret="+facebookSecret)
//     .spread(function(res, body){
//       facebookToken = body.split("access_token=")[1] || null;
//       // if(!facebookToken){
//       //   throw "Invalid FB Access Token!";
//       // }
//       throw "Invalid FB Access Token!";
//       // return facebookToken;
//     });
//   }
// };

//starts the data gathering sequence
getAllTokens()
.then(function(tokens){
  console.log("TOKENS:", tokens);
  //geo-codes the target address 
  return request.getAsync({url:"https://maps.googleapis.com/maps/api/geocode/json", qs:{key:googleApiKey, sensor:"false", address:targetAddress}});
})
.spread(function(res, body){
  body = JSON.parse(body);
  if(body.status === "OK"){
    var lat = body.results[0].geometry.location.lat;
    var lon = body.results[0].geometry.location.lng;
    console.log("Lat:", lat, "Long:", lon, "Status: OK");
    return {lat: lat, lon:lon};
  }else {
    throw "Google API Error: "+body.status;
  }
})
.then(function(data){
  var latMile = 1/69;
  var coords = [];
  var startLat = data.lat;
  var startLon = data.lon;
  var searchWidth = 10; //in miles
  //creates a list of coords spaced 0.5 mile apart in a grid, for a 10x10 mile box
  for(var i = -searchWidth; i<=searchWidth; i++){
    for(var j = -searchWidth; j<=searchWidth; j++){
      coords.push({
        lat: startLat+latMile/2*i, 
        lon: startLon+latMile/2*j
      });
    }
  }
  console.log("querying", coords.length,"coordinates");
  var eventPromises = _.map(coords, function(item, index){
    return Promise.delay(index * 100)
    .then(function(){
      return getPlacesAtLocation(item.lat, item.lon);
    });
  });
  return Promise.all(eventPromises);
})
.then(function(){
  //have all the location names now
  locationNames = _.uniq(locationNames);
  console.log("PLACES:", locationNames);
  console.log("PLACES:", locationNames.length);
  console.log("Getting "+locationNames.length+" EventIdsByLocationName..");
  
  //delayed to prevent denial of service - very big operation, 1 call per location name
  var eventPromises = _.map(locationNames, function(place, index){
    return Promise.delay(1000*index).then(function(){
      return getEventIdsByLocationName(place, index);
    });
  });

  //populates global eventIds array
  return Promise.all(eventPromises);
})
.then(function(){
  var superArray = arraySplit(eventIds, 2000);
  console.log("eventIds length:",eventIds.length);
  //delays to prevent denial of service
  var eventPromises = _.map(superArray, function(eids, index){
    return Promise.delay(2000*index).then(function(){
      return getEvents(eids);
    });
  });

  //populates global events array
  return Promise.all(eventPromises);
})
.then(function(){
  console.log("Total Events:", events.length);
  console.log("Trying to load events into DB..");
  var eventPromises = _.map(events, function(item){
    //add to db 
    var fee = null;
    if(item.ticket_uri){
      fee = 99999;
    }
    // console.log(item);
    var dbItem = {
      name: item.name,
      description: item.description,
      duration: (new Date(item.end_time).getTime() - new Date(item.start_time).getTime()) || 3*60*60*1000,
      fee: fee,
      rsvpCount: item.attending_count,
      time: new Date(item.start_time).getTime(),
      url: "https://www.facebook.com/events/"+item.eid+"/",
      venue: {
        name: item.location,
        address: {
          city: item.venue.city,
          country: item.venue.country,
          state: item.venue.state,
          address1: item.venue.street +", "+item.venue.city,
          latitude: item.venue.latitude,
          longitude: item.venue.longitude,
        }
      },
      ticketUrl: item.ticket_uri || null,
      unique: item.eid
    };
    if(item.venue.latitude && item.venue.longitude){
      dbItem.location = [item.venue.lon, item.venue.lat];
    }
    return db.facebook.findOne({unique: dbItem.unique})
    .then(function(entry){
      insertCount++;
      if(!entry){
        return db.facebook.insert(dbItem);
      }else{
        return db.facebook.update({unique: dbItem.unique}, dbItem);
      }
    });
  });
  return Promise.all(eventPromises);
})
.then(function(){
  terminateProgram();
})
.catch(function(err){
  console.log("ERR:", err);
  terminateProgram();
});

