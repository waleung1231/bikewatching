import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

mapboxgl.accessToken = 'pk.eyJ1Ijoid2FsZXVuZyIsImEiOiJjbTdlMzgwYWswNGl5MmxuOGYzcGQ1eWhzIn0.85Xk2KqxGnBa1NnPjwNs9Q';

// Initialize time filter variables
let timeFilter = -1;
let trips = [];
let stations = [];
let filteredStations = [];

// Initialize minute buckets for departures and arrivals
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Time formatting and conversion functions
function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

// Helper function to filter trips by minute accounting for midnight crossover
function filterByMinute(tripsByMinute, minute) {
    if (minute === -1) {
        return tripsByMinute.flat();
    }
    
    // Normalize both to the [0, 1439] range
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;

    if (minMinute > maxMinute) {
        let beforeMidnight = tripsByMinute.slice(minMinute);
        let afterMidnight = tripsByMinute.slice(0, maxMinute);
        return beforeMidnight.concat(afterMidnight).flat();
    } else {
        return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}

// Initialize map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18
});

const svg = d3.select('#map').select('svg');

function getCoords(station) {
    const lon = station.longitude || station.lon || station.Long;
    const lat = station.latitude || station.lat || station.Lat;
    
    if (typeof lon === 'undefined' || typeof lat === 'undefined') {
        console.error('Invalid coordinates for station:', station);
        return { cx: 0, cy: 0 };
    }
    
    const numLon = +lon;
    const numLat = +lat;
    
    if (isNaN(numLon) || isNaN(numLat)) {
        console.error('Invalid numeric coordinates:', { lon, lat });
        return { cx: 0, cy: 0 };
    }
    
    const point = new mapboxgl.LngLat(numLon, numLat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
}

function filterTripsbyTime() {
    // Get filtered trips using the bucketed data
    const filteredDepartures = d3.rollup(
        filterByMinute(departuresByMinute, timeFilter),
        v => v.length,
        d => d.start_station_id
    );

    const filteredArrivals = d3.rollup(
        filterByMinute(arrivalsByMinute, timeFilter),
        v => v.length,
        d => d.end_station_id
    );

    // Update stations with filtered data
    filteredStations = stations.map(station => {
        const newStation = { ...station };
        const id = newStation.short_name;
        newStation.departures = filteredDepartures.get(id) ?? 0;
        newStation.arrivals = filteredArrivals.get(id) ?? 0;
        newStation.totalTraffic = newStation.departures + newStation.arrivals;
        return newStation;
    });

    updateVisualization();
}

function updateVisualization() {
    // Create dynamic radius scale based on filter state
    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(filteredStations, d => d.totalTraffic)])
        .range(timeFilter === -1 ? [0, 25] : [3, 50]);

    // Create flow scale for color
    const stationFlow = d3.scaleQuantize()
        .domain([0, 1])
        .range([0, 0.5, 1]);

    // Update circles
    const circles = svg.selectAll('circle')
        .data(filteredStations)
        .join('circle')
        .attr('r', d => radiusScale(d.totalTraffic))
        .style('--departure-ratio', d => {
            if (d.totalTraffic === 0) return 0.5; // Default to balanced when no traffic
            return stationFlow(d.departures / d.totalTraffic);
        });

    // Update tooltips
    circles.select('title').remove();
    circles.append('title')
        .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);

    // Update positions
    circles.each(function(d) {
        const coords = getCoords(d);
        d3.select(this)
            .attr('cx', coords.cx)
            .attr('cy', coords.cy);
    });
}

// Time slider interaction
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

// Throttle helper function
function throttle(func, limit) {
    let inThrottle;
    let lastArgs;
    let lastThis;
    let timeoutId;

    return function throttled(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        } else {
            // Save last call arguments
            lastArgs = args;
            lastThis = this;
            // Clear any existing delayed execution
            clearTimeout(timeoutId);
            // Schedule a throttled call
            timeoutId = setTimeout(() => {
                if (lastArgs) {
                    func.apply(lastThis, lastArgs);
                    lastArgs = lastThis = null;
                }
            }, limit);
        }
    };
}

function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    // Update display immediately
    if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
    } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
    }

    // Filter data and update visualization
    filterTripsbyTime();
}

// Throttle the update function to run at most every 50ms
const throttledUpdate = throttle(updateTimeDisplay, 50);

// Add event listeners
timeSlider.addEventListener('input', throttledUpdate);

map.on('load', async () => {
    // Add bike lanes layer
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
    });
    
    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': 'green',
            'line-width': 3,
            'line-opacity': 0.4
        }
    });

    try {
        // Load station and trip data
        const [stationData, tripData] = await Promise.all([
            d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json'),
            d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv')
        ]);

        stations = stationData.data.stations;
        trips = tripData;
        
        // Process trip data and fill minute buckets
        for (let trip of trips) {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            
            // Add to departure and arrival buckets
            const startMinutes = minutesSinceMidnight(trip.started_at);
            const endMinutes = minutesSinceMidnight(trip.ended_at);
            
            departuresByMinute[startMinutes].push(trip);
            arrivalsByMinute[endMinutes].push(trip);
        }

        // Initialize filtered data
        filterTripsbyTime();
        
        // Set up map event handlers
        map.on('move', updateVisualization);
        map.on('zoom', updateVisualization);
        map.on('resize', updateVisualization);
        map.on('moveend', updateVisualization);

        // Initialize time display
        updateTimeDisplay();

    } catch (error) {
        console.error('Error loading data:', error);
    }
});