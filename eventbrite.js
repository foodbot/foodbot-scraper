var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var cheerio = require('cheerio');
var _ = require('underscore');

var pmongo = require('promised-mongo');
var db = pmongo('mongodb://localhost:27017/feedme', ["eventbrite"]);

var googleApiKey = process.env.GOOGLEAPIKEY || "123FAKEKEY";
var eventUrls = [];
var pageCount = 0;
var insertCount = 0;
var getSearchPageUrl = function(pageNum){
  return "http://www.eventbrite.com/directory?loc=San+Francisco%2C+CA&is_miles=True&vp_ne_lat=37.812&price=1&vp_sw_lng=-122.527&page="+pageNum+"&slng=-122.42&vp_sw_lat=37.7034&radius=60.0&vp_ne_lng=-122.3482&slat=37.77";
};
//need to manually terminate program when scraping complete, since db connection is always open
var terminateProgram = function(){
  console.log("Program finished,", insertCount, "entries added / updated");
  process.exit(1);
};
//recursively get urls of all event pages from search results
var getEventLinks = function(pageNum, recursiveCount, finishCallback){
  var url = getSearchPageUrl(pageNum);
  var $;
  console.log("GET Search Page:", pageNum);
  pageCount++;
  request.getAsync(url)
  .then(function(args){
    $ = cheerio.load(args[1]);
    return $(".js-search-result-click-action").toArray();
  })
  .map(function(link){
    var url = $(link).attr('href');
    return url.split("?")[0]; 
  })
  .then(function(links){
    return _.uniq(links);
  })
  .then(function(links){
    console.log("Links Found:", links.length);
    eventUrls = eventUrls.concat(links);

    if(recursiveCount > 1 && links.length > 0){
      getEventLinks(pageNum+1, recursiveCount-1, finishCallback);
    }else{
      console.log("Loaded "+pageCount+" pages and "+eventUrls.length+" event urls");
      eventUrls = _.uniq(eventUrls);
      finishCallback(eventUrls);
    }
  })
  .catch(function(err){
    console.log("ERR:", err);
  });
};
var getEventLinksAsync = function(pageNum, recursiveCount){
  return new Promise(function(resolve, reject){
    getEventLinks(pageNum, recursiveCount, resolve);
  });
};
//scrapes target eventbrite event url
var scrapeEventPage = function(url, index){
  return request.getAsync(url)
  .then(function(args){
    console.log("GET["+index+"]:", url);
    var $ = cheerio.load(args[1]);
    var address = $("span.adr").text().trim().replace(/(\r\n|\n|\r)/gm,"").replace(/\s+/g, " ") ||
                  $(".l-block-3 li").first().text().trim().replace(/(\r\n|\n|\r)/gm,"").replace(/\s+/g, " ");
    var venueName = $(".fn.org").text().trim() ||
                    $(".l-block-3 h2").first().text().trim();
    var startTime = new Date($("span.dtstart").text().trim().split(" to ")[0].replace(" from", "") +" PDT").getTime() ||
                    new Date($("span.dtstart").text().trim().split(" - ")[0].replace(" at", "")+" PDT").getTime() ||
                    new Date($("time").first().text().trim().split(" to ")[0].replace(" from", "")+" PDT").getTime();
    var endTime;
    var item = {
      name: $("#event_header h1").text(),
      description: $(".panel_section").text(),
      duration: 3*60*60*1000,
      fee: null,
      rsvpCount: parseInt($(".count_subview").text().trim().split(" people")[0]),
      time: startTime,
      url: url,
      venue: {
        name: venueName,
        address: {
          city: "San Francisco",
          country: "us",
          state: "ca",
          address1: address,
          latitude: null,
          longitude: null,
        }
      },
      unique: url
    };

    return Promise.all([
      request.getAsync({url:"https://maps.googleapis.com/maps/api/geocode/json", qs:{key:googleApiKey, sensor:"false", address:address}}),
      item
    ]);
  })
  .spread(function(args, item){
    var body = JSON.parse(args[1]);
    if(body.status === "OK"){
      var lat = body.results[0].geometry.location.lat;
      var lon = body.results[0].geometry.location.lng;
      if(lat && lon){
        item.location = [lat, lon];
      }
      item.venue.address.latitude = lat;
      item.venue.address.longitude = lon;
      return item;
    }else {
      throw "Google API Error: "+body.status;
    }
  })
  .then(function(item){
    return Promise.all([
      db.eventbrite.findOne({unique: item.unique}),
      item
    ]);
  })
  .spread(function(entry, item){
    insertCount++;
    if(!entry){
      return db.eventbrite.insert(item);
    }else{
      return db.eventbrite.update({unique: item.unique}, item);
    }
  });
};

getEventLinksAsync(1, 99999)
.then(function(urls){
  var eventPromises = _.map(urls, function(url, index){
    //Spaced them out so I don't DoS them
    return Promise.delay(index*300).then(function(){
      return scrapeEventPage(url, index);
    });
  });
  return Promise.all(eventPromises);
})
.then(function(){
  terminateProgram();  
})
.catch(function(err){
  console.log("Err:", err);
  terminateProgram();
});

