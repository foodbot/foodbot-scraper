var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
var cheerio = require('cheerio');
var _ = require('underscore');

var pmongo = require('promised-mongo');
var db = pmongo('mongodb://localhost:27017/feedme', ["eventbrite"]); // feedmeserver.cloudapp.net

var googleApiKey = process.env.GOOGLEAPIKEY || "123FAKEKEY";
var targetUrl = "http://sf.funcheap.com/category/event/event-types/free-food/";
var terminateTimer;
var eventUrls = [];
var pageCount = 0;
var insertCount = 0;
//need to manually terminate program when scraping complete, since db connection is always open
var terminateProgram = function(){
  console.log("Program finished,", insertCount, "entries added / updated");
  process.exit(1);
};
//terminates program in 30 sec, if no actions taken
var refreshTerminateTimer = function(){
  if(terminateTimer){
    // console.log("Resetting timer");
    clearTimeout(terminateTimer);
    terminateTimer = null;
  }
  terminateTimer = setTimeout(terminateProgram, 30*1000);
};
//recursively get urls of all event pages from search results
var getEventLinks = function(url, recursiveCount, finishCallback){
  var $;
  pageCount++;
  request.getAsync(url)
  .then(function(args){
    $ = cheerio.load(args[1]);
    return $("span.title a").toArray();
  })
  .map(function(link){
    return $(link).attr('href');
  })
  .then(function(links){
    return _.uniq(links);
  })
  .then(function (links){
    console.log("Links Found:", links.length);
    eventUrls = eventUrls.concat(links);
    var nextPagePath = $("#next.nav").attr('href'); //placeholder
    // console.log("Next Path:", nextPagePath);
    if(recursiveCount > 1 && nextPagePath){
      getEventLinks("http://www.eventbrite.com"+nextPagePath, recursiveCount-1, finishCallback);
    }else{
      console.log("Loaded "+pageCount+" pages and "+eventUrls.length+" event urls");
      eventUrls = _.uniq(eventUrls);
      finishCallback(eventUrls);
    }
  });
};
//scrapes target eventbrite event url
var scrapeEventPage = function(url, index){
  request.getAsync(url)
  .then(function(args){
    console.log("GET["+index+"]:", url);
    var $ = cheerio.load(args[1]);
    var address = $("span.adr").text().trim().replace(/(\r\n|\n|\r)/gm,"").replace(/\s+/g, " ") ||
                  $(".l-block-3 li").first().text().trim().replace(/(\r\n|\n|\r)/gm,"").replace(/\s+/g, " ");
    var venueName = $(".fn.org").text().trim() ||
                    $(".l-block-3 h2").first().text().trim();
    var startTime = new Date($("span.dtstart").text().trim().split(" to ")[0].replace(" from", "")).getTime() ||
                    new Date($("span.dtstart").text().trim().split(" - ")[0].replace(" at", "")).getTime() ||
                    new Date($("time").first().text().trim().split(" to ")[0].replace(" from", "")).getTime();
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
    request.getAsync({url:"https://maps.googleapis.com/maps/api/geocode/json", qs:{key:googleApiKey, sensor:"false", address:address}})
    .then(function(args){
      var body = JSON.parse(args[1]);
      if(body.status === "OK"){
        var lat = body.results[0].geometry.location.lat;
        var lon = body.results[0].geometry.location.lng;
        item.venue.address.latitude = lat;
        item.venue.address.longitude = lon;
        // console.log("Status: OK, lat: ",lat,"lon:",lon);
      }else {
        console.log("API Error:", body.status);
      }
      db.eventbrite.findOne({unique: item.unique})
      .then(function(entry){
        refreshTerminateTimer();
        insertCount++;
        if(!entry){
          // console.log("Inserting:", item);
          db.eventbrite.insert(item);
        }else{
          // console.log("Updating:", item);
          db.eventbrite.update({unique: item.event_url}, item);
        }
      })
      .catch(function(err){
        console.log("DB error:", err);
      });
    });
    
  });
};

getEventLinks(targetUrl, 99999, function(urls){
  _.each(urls, function(url, index){
    console.log(url);
    //Spaced them out so I don't DoS them
    // setTimeout(function(){
    //   scrapeEventPage(url, index);
    // }, index*500);
  });
});


