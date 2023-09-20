/*
 * Copyright 2019 Ilker Temir <ilker@ilkertemir.com>
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const POLL_INTERVAL = 1      // Poll every N seconds
const API_BASE = 'https://stations.windy.com./pws/update/';
const request = require('request')

const WIND_SPEED_PATH = "environment.wind.speedTrue";
const WIND_DIR_PATH = "environment.wind.directionTrue";

const median = arr => {
  const mid = Math.floor(arr.length / 2),
    nums = [...arr].sort((a, b) => a - b);
  return arr.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
};

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];
  var submitProcess;
  var statusProcess;
  var lastSuccessfulUpdate;
  var name = app.getSelfPath('name');

  var position;
  var windSpeed = [];
  var windGust;
  var windDirection;
  var waterTemperature = 20;
  var temperature = 25;
  var pressure = 1000;
  var humidity = 0.8;

  plugin.id = "signalk-windy";
  plugin.name = "SignalK Windy.com";
  plugin.description = "Windy.com plugin for Signal K";

  plugin.schema = {
    type: 'object',
    required: ['apiKey', 'submitInterval', 'stationId'],
    properties: {
      apiKey: {
        type: 'string',
        title: 'API Key (obtain from stations.windy.com)'
      },
      submitInterval: {
        type: 'number',
        title: 'Submit Interval (minutes)',
        default: 5
      },
      stationId: {
        type: 'number',
        title: 'Windy.com Station ID',
        default: 100 
      },
      provider: {
        type: 'string',
        title: 'Provider',
        default: ''
      },
      url: {
        type: 'string',
        title: 'Web Site',
        default: ''
      }
    }
  }

  plugin.start = function(options) {
    if (!options.apiKey) {
      app.error('API Key is required');
      return
    } 

    app.setPluginStatus(`Submitting weather report every ${options.submitInterval} minutes`);

    let subscription = {
      context: 'vessels.self',
      subscribe: [{
        path: 'navigation.position',
        period: POLL_INTERVAL * 1000
      }, {
        path: WIND_DIR_PATH,
        period: POLL_INTERVAL * 1000
      }, {
        path: WIND_SPEED_PATH,
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.water.temperature',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.outside.temperature',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.outside.pressure',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.outside.humidity',
        period: POLL_INTERVAL * 1000
      }]
    };

    app.subscriptionmanager.subscribe(subscription, unsubscribes, function() {
      app.debug('Subscription error');
    }, data => processDelta(data));

    app.debug(`Starting submission process every ${options.submitInterval} minutes`);

    statusProcess = setInterval( function() {
      var statusMessage = '';
      if (lastSuccessfulUpdate) {
        let since = timeSince(lastSuccessfulUpdate);
      	statusMessage += `Successful submission ${since} ago. `;
      }
      if ((windSpeed.length > 0) && (windGust != null)) {
      	let currentWindSpeed = windSpeed[windSpeed.length-1];
      	statusMessage += `Wind speed is ${currentWindSpeed}m/s and gust is ${windGust}m/s.`;
      } 
      app.setPluginStatus(statusMessage);
    }, 5 * 1000);

    submitProcess = setInterval( function() {
      if ( (position == null) || (windSpeed.length == 0) || (windDirection == null) ||
           (temperature == null) ) {
	      let message = `Not submitting position due to lack of position ${position.latitude}, wind ` +
	              `speed ${windSpeed}, wind direction ${windDirection} or temperature ${temperature}.`;
	      app.debug(message);
        return
      }
      let data = {
        stations: [
          { station: options.stationId,
            name: name,
            shareOption: 'Open',
            type: 'Signal K Windy Plugin',
            provider: options.provider,
            url: options.url,
            lat: position.latitude,
            lon: position.longitude,
            elevation: 1 }
        ],
        observations: [
          { station: options.stationId,
            wind: median(windSpeed),
	          gust: windGust,
            winddir: windDirection,
          }
        ]
      }
    
      let httpOptions = {
        uri: API_BASE + options.apiKey,
        method: 'POST',
        json: data
      };

      app.debug(`Submitting data: ${JSON.stringify(data)}`);
      request(httpOptions, function (error, response, body) {
        if (!error || response.statusCode == 200) {
          app.debug('Weather report successfully submitted');
	        lastSuccessfulUpdate = Date.now();
          position = null;
          windSpeed = [];
          windGust = null;
          windDirection = null;
          waterTemperature = 22;
          temperature = 25;
          pressure = 1000;
          humidity = .70;
        } else {
          app.debug('Error submitting to Windy.com API');
          app.debug(body); 
        }
      }); 
    }, options.submitInterval * 60 * 1000);
  }

  plugin.stop =  function() {
    clearInterval(statusProcess);
    clearInterval(submitProcess);
    app.setPluginStatus('Pluggin stopped');
  };

  function radiantToDegrees(rad) {
    return rad * 57.2958;
  }

  function kelvinToCelsius(deg) {
    return deg - 273.15;
  }

  function processDelta(data) {
    if (!data.updates || !data.updates.length || !data.updates[0].values || !data.updates[0].values.length) {
      return;
    }
    let dict = data.updates[0].values[0];
    let path = dict.path;
    let value = dict.value;

    switch (path) {
      case 'navigation.position':
        position = value;
        break;
      case WIND_SPEED_PATH:
        let speed = value.toFixed(2);
        speed = parseFloat(speed);
        if ((windGust == null) || (speed > windGust)) {
            windGust = speed;
        }
        windSpeed.push(speed);
        break;
      case WIND_SPEED_PATH:
        windDirection = radiantToDegrees(value);
        windDirection = Math.round(windDirection);
        break;
      case 'environment.water.temperature':
        waterTemperature = kelvinToCelsius(value);
        waterTemperature = waterTemperature.toFixed(1);
        waterTemperature = parseFloat(waterTemperature);
        break;
      case 'environment.outside.temperature':
        temperature = kelvinToCelsius(value);
        temperature = temperature.toFixed(1);
        temperature = parseFloat(temperature);
        break;
      case 'environment.outside.pressure':
        pressure = parseFloat(value);
        break;
      case 'environment.outside.humidity':
        humidity = Math.round(100*parseFloat(value));
        break;
      default:
        app.debug('Unknown path: ' + path);
    }
  }

  function timeSince(date) {
    var seconds = Math.floor((new Date() - date) / 1000);
    var interval = seconds / 31536000;
    if (interval > 1) {
      return Math.floor(interval) + " years";
    }
    interval = seconds / 2592000;
    if (interval > 1) {
      return Math.floor(interval) + " months";
    }
    interval = seconds / 86400;
    if (interval > 1) {
      return Math.floor(interval) + " days";
    }
    interval = seconds / 3600;
    if (interval > 1) {
      let time = Math.floor(interval);
      if (time == 1) {
        return (`${time} hour`);
      } else {
	return (msg = `${time} hours`);
      }
    }
    interval = seconds / 60;
    if (interval > 1) {
      let time = Math.floor(interval);
      if (time == 1) {
        return (`${time} minute`);
      } else {
	return (msg = `${time} minutes`);
      }
    }
    return Math.floor(seconds) + " seconds";
  }

  return plugin;
}