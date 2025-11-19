/***************************************************
 * EPSG:25832 => WGS84
 ***************************************************/
proj4.defs("EPSG:25832", "+proj=utm +zone=32 +ellps=GRS80 +datum=ETRS89 +units=m +no_defs");

// Cloudflare proxy til VD-reference
const VD_PROXY = "https://vd-proxy.anderskabel8.workers.dev";

/*
 * OpenRouteService integration
 *
 * For at tilføje ruteplanlægning baseret på OpenStreetMap-data har vi
 * integreret OpenRouteService (ORS). ORS tilbyder en gratis plan med
 * 2.000 ruteopslag pr. dag og 40 pr. minut【176505938843089†L27-L31】. Før du kan
 * anvende tjenesten skal du oprette en gratis konto og hente en API-nøgle.
 * Besøg https://openrouteservice.org/, opret en konto og generér en nøgle
 * under sektionen "API Keys" i din brugerprofil. Indsæt nøglen i
 * konstanten ORS_API_KEY nedenfor.
 */

// TODO: Indsæt din ORS API-nøgle her
const ORS_API_KEY = "YOUR_ORS_API_KEY_HERE";

// Lag til at vise ruter fra ORS. Tilføjes til overlayMaps senere.
var routeLayer = L.layerGroup();

/**
 * Udtræk et repræsentativt punkt fra en vejgeometri
 *
 * Når en vej hentes fra Dataforsyningen returneres geometrien som en
 * GeoJSON MultiLineString (ofte i EPSG:25832). Vi vælger det første
 * koordinatsæt som repræsentativt punkt og konverterer det til
 * WGS84. Dette punkt bruges som start- eller slutpunkt til rute-
 * planlægning i ORS.
 *
 * @param {Object} geometry GeoJSON-objekt med type MultiLineString
 * @returns {Array|null} Array [lat, lon] i WGS84 eller null
 */
function getRepresentativeCoordinate(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  // Hent første koordinatsæt (kan være nested arrays)
  let coords = geometry.coordinates;
  // MultiLineString: array af lines, hver med array af koordinater
  let firstLine = Array.isArray(coords[0]) ? coords[0] : null;
  if (!firstLine || firstLine.length === 0) return null;
  let firstCoord = firstLine[0];
  if (!firstCoord || firstCoord.length < 2) return null;
  let x = firstCoord[0];
  let y = firstCoord[1];
  // Hvis koordinaterne er i UTM (typisk > 90), konverter til WGS84
  if (Math.abs(x) > 90 || Math.abs(y) > 90) {
    let [lat, lon] = convertToWGS84(x, y);
    return [lat, lon];
  }
  // Ellers antag allerede WGS84: [lon, lat]
  return [firstCoord[1], firstCoord[0]];
}

/**
 * Planlæg en rute mellem de to valgte veje ved hjælp af ORS
 *
 * Denne funktion anvender de globalt valgte veje (selectedRoad1 og
 * selectedRoad2) og beregner en rute mellem dem. Den henter et
 * repræsentativt punkt fra hver vejgeometri, kalder ORS' Directions-
 * API og tegner den returnerede rute som en polyline på kortet.
 */
async function planRouteORS() {
  if (!selectedRoad1 || !selectedRoad2) {
    alert("Vælg venligst to veje først (vej 1 og vej 2) før ruteplanlægning.");
    return;
  }
  if (!ORS_API_KEY || ORS_API_KEY.includes("YOUR_ORS_API_KEY")) {
    alert("ORS API-nøgle mangler. Indsæt din nøgle i konstanten ORS_API_KEY.");
    return;
  }
  // Udtræk start- og slutkoordinater
  let start = getRepresentativeCoordinate(selectedRoad1.geometry);
  let end   = getRepresentativeCoordinate(selectedRoad2.geometry);
  if (!start || !end) {
    alert("Kunne ikke udlede koordinater fra de valgte veje.");
    return;
  }
  let [startLat, startLon] = start;
  let [endLat, endLon]     = end;
  // Konstruér API‑URL. Vi bruger driving-car profil og GeoJSON format for geometri.
  const orsUrl = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${ORS_API_KEY}&start=${startLon},${startLat}&end=${endLon},${endLat}&geometry_format=geojson`;
  try {
    let resp = await fetch(orsUrl);
    if (!resp.ok) {
      throw new Error(`ORS-fejl: ${resp.status} ${resp.statusText}`);
    }
    let data = await resp.json();
    if (!data.features || data.features.length === 0) {
      alert("ORS returnerede ingen rute.");
      return;
    }
    let routeGeom = data.features[0].geometry;
    if (routeGeom.type !== "LineString" || !Array.isArray(routeGeom.coordinates)) {
      alert("ORS returnerede ukendt geometri.");
      return;
    }
    // Fjern tidligere rute
    routeLayer.clearLayers();
    // Rutegeometri er i [lon, lat]; konverter til [lat, lon]
    let latLngs = routeGeom.coordinates.map(coord => [coord[1], coord[0]]);
    L.polyline(latLngs, {
      color: 'blue',
      weight: 5,
      opacity: 0.7
    }).addTo(routeLayer);
    // Zoom til ruten
    map.fitBounds(latLngs);
  } catch (err) {
    console.error("ORS ruteplanlægningsfejl:", err);
    alert("Der opstod en fejl ved hentning af ruten. Se konsollen for detaljer.");
  }
}

function convertToWGS84(x, y) {
  // Ved at bytte parameterne [y, x] opnår vi, at northing (y) kommer først,
  // som derefter bliver konverteret til latitude, og easting (x) til longitude.
  let result = proj4("EPSG:25832", "EPSG:4326", [x, y]);
  console.log("convertToWGS84 output:", result);
  // Returnér [latitude, longitude] til Leaflet
  return [result[1], result[0]];
}

/***************************************************
 * Custom Places
 *
 * Nogle steder, fx mindre bakkedrag eller fredede fortidsminder,
 * figurerer ikke som officielle stednavne i Dataforsyningens søge-API.
 * Hvis man ønsker at kunne finde disse via søgefeltet, kan de
 * tilføjes til dette array. Hvert element indeholder navnet på
 * stedet og dets koordinater i WGS84 (latitude, longitude).
 */
var customPlaces = [
  {
    navn: "Tellerup Bjerge",
    coords: [55.38627, 9.92760]
  }
  // Fremtidige specialsteder kan tilføjes her
];

/***************************************************
 * Hjælpefunktion til at kopiere tekst til clipboard
 ***************************************************/
function copyToClipboard(str) {
  let finalStr = str.replace(/\\n/g, "\n");
  navigator.clipboard.writeText(finalStr)
    .then(() => {
      console.log("Copied to clipboard:", finalStr);
    })
    .catch(err => {
      console.error("Could not copy text:", err);
    });
}

/***************************************************
 * Funktion til visning af kopieret popup
 ***************************************************/
function showCopyPopup(message) {
  let popup = document.createElement('div');
  popup.textContent = message;
  popup.style.position = "fixed";
  popup.style.top = "20px";
  popup.style.left = "50%";
  popup.style.transform = "translateX(-50%)";
  popup.style.background = "rgba(0,0,0,0.7)";
  popup.style.color = "white";
  popup.style.padding = "10px 15px";
  popup.style.borderRadius = "5px";
  popup.style.zIndex = "1000";
  document.body.appendChild(popup);
  setTimeout(function() {
    if (popup.parentElement) {
      popup.parentElement.removeChild(popup);
    }
  }, 1500);
}

/***************************************************
 * Funktion til beregning af sorteringsprioritet
 * Lavere tal betyder bedre match.
 ***************************************************/
function getSortPriority(item, query) {
  let text = "";
  if (item.type === "adresse") {
    text = item.tekst || "";
  } else if (item.type === "stednavn") {
    text = item.navn || "";
  } else if (item.type === "strandpost") {
    text = item.tekst || "";
  } else if (item.type === "navngivenvej") {
    // navngivne veje bruger 'navn' som tekstfelt
    text = item.navn || "";
  } else if (item.type === "custom") {
    // custom places bruger 'navn' som primært tekstfelt
    text = item.navn || "";
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerText === lowerQuery) {
    return 0; // Perfekt match
  } else if (lowerText.startsWith(lowerQuery)) {
    return 1;
  } else if (lowerText.includes(lowerQuery)) {
    return 2;
  } else {
    return 3;
  }
}

/***************************************************
 * Funktioner til automatisk dataopdatering (24 timer)
 ***************************************************/
function getLastUpdated() {
  return localStorage.getItem("strandposterLastUpdated");
}

function setLastUpdated() {
  localStorage.setItem("strandposterLastUpdated", Date.now());
}

function shouldUpdateData() {
  const lastUpdated = getLastUpdated();
  if (!lastUpdated) {
    return true;
  }
  // 24 timer = 86.400.000 millisekunder
  return Date.now() - parseInt(lastUpdated, 10) > 86400000;
}

/***************************************************
 * Opret Leaflet-kort og lag
 ***************************************************/
var map = L.map('map', {
  center: [56, 10],
  zoom: 7,
  zoomControl: false
});

// OpenStreetMap-lag
var osmLayer = L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors, © Styrelsen for Dataforsyning og Infrastruktur,© CVR API"
  }
).addTo(map);

/***************************************************
 * TILFØJET: Ortofoto-lag fra Kortforsyningen (satellit)
 ***************************************************/
var ortofotoLayer = L.tileLayer.wms(
  "https://api.dataforsyningen.dk/orto_foraar_DAF?service=WMS&request=GetCapabilities&token=a63a88838c24fc85d47f32cde0ec0144",
  {
    layers: "orto_foraar",
    format: "image/jpeg",
    transparent: false,
    version: "1.1.1",
    attribution: "Ortofoto © Kortforsyningen"
  }
);

// Opret WMS-lag for redningsnumre (Strandposter)
var redningsnrLayer = L.tileLayer.wms("https://kort.strandnr.dk/geoserver/nobc/ows", {
  layers: "Redningsnummer",
  format: "image/png",
  transparent: true,
  version: "1.3.0",
  attribution: "Data: redningsnummer.dk"
});

/**
 * Rutenummereret vejnet (VD Geocloud WMS)
 * Dette lag viser rutenumre på det overordnede vejnet. Det blev fjernet i en
 * senere version, men genindføres her for at give mulighed for at slå
 * rutenumre til og fra via lagkontrollen. Laget hentes som et WMS-billede
 * fra Vejdirektoratets Geocloud.
 */
var rutenummerLayer = L.tileLayer.wms("https://geocloud.vd.dk/VM/wms", {
  layers: "rutenummereret-vejnet",
  format: "image/png",
  transparent: true,
  version: "1.3.0",
  attribution: "© Vejdirektoratet"
});

/***************************************************
 * NYT: Opret nyt Falck Ass-lag (GeoJSON)
 * Henter data fra filen "FalckStationer_data.json"
 ***************************************************/
var falckAssLayer = L.geoJSON(null, {
  onEachFeature: function(feature, layer) {
    let tekst = feature.properties.tekst || "Falck Ass";
    layer.bindPopup("<strong>" + tekst + "</strong>");
  },
  style: function(feature) {
    return { color: "orange" };
  }
});

fetch("FalckStationer_data.json")
  .then(response => response.json())
  .then(data => {
    falckAssLayer.addData(data);
    console.log("Falck Ass data loaded", data);
  })
  .catch(err => console.error("Fejl ved hentning af Falck Ass data:", err));

/***************************************************
 * Opret kommunegrænser layer (GeoJSON fra Dataforsyningen)
 ***************************************************/
var kommunegrænserLayer = L.geoJSON(null, {
  style: function(feature) {
    return {
      color: "#3388ff",
      weight: 2,
      fillOpacity: 0
    };
  }
});

fetch("https://api.dataforsyningen.dk/kommuner?format=geojson")
  .then(response => response.json())
  .then(data => {
    kommunegrænserLayer.addData(data);
    console.log("Kommunegrænser hentet:", data);
  })
  .catch(err => console.error("Fejl ved hentning af kommunegrænser:", err));

/***************************************************
 * Tilføj lagkontrol
 ***************************************************/
// Lag til DB SMS kort (åbner dvc.nsf/kort) og DB Journal
var dbSmsLayer        = L.layerGroup();
var dbJournalLayer    = L.layerGroup();
// 25 km grænse – et tomt layer, vi vil tegne en forskudt grænse på
var border25Layer = L.layerGroup();
// Ladestandere-lag (Open Charge Map)
var chargeMapLayer = L.layerGroup();

// Hent grænser og forskyd dem
var originalBorderCoords = [];
fetch("dansk-tysk-grænse.geojson")
  .then(r => r.json())
  .then(g => {
    originalBorderCoords = g.features[0].geometry.coordinates;
    var offsetCoords = originalBorderCoords.map(function(coord) {
      var lon = coord[0], lat = coord[1];
      var [x, y] = proj4("EPSG:4326", "EPSG:25832", [lon, lat]);
      y -= 25000;
      var [lon2, lat2] = proj4("EPSG:25832", "EPSG:4326", [x, y]);
      return [lat2, lon2];
    });
    L.polyline(offsetCoords, {
      color: 'red',
      weight: 2,
      dashArray: '5,5'
    }).addTo(border25Layer);
  });
fetch("svensk-grænse.geojson")
  .then(r => r.json())
  .then(g => {
    var coords = g.features[0].geometry.coordinates;
    var swOffset = coords.map(function(coord) {
      var lon = coord[0], lat = coord[1];
      var [x, y] = proj4("EPSG:4326", "EPSG:25832", [lon, lat]);
      y += 25000;
      var [lon2, lat2] = proj4("EPSG:25832", "EPSG:4326", [x, y]);
      return [lat2, lon2];
    });
    L.polyline(swOffset, {
      color: 'red',
      weight: 2,
      dashArray: '5,5'
    }).addTo(border25Layer);
  });

const baseMaps = {
  "OpenStreetMap": osmLayer,
  "Satellit": ortofotoLayer
};
const overlayMaps = {
  "Strandposter": redningsnrLayer,
  "Falck Ass": falckAssLayer,
  "Kommunegrænser": kommunegrænserLayer,
  "DB SMS kort":       dbSmsLayer,
  "DB Journal":        dbJournalLayer,
  "25 km grænse": border25Layer,
  "Ladestandere": chargeMapLayer,
  // Overordnede rutenumre på vejnettet
  "Rutenummereret vejnet": rutenummerLayer
  ,
  // Ruteplan via OpenRouteService
  "Rute (ORS)": routeLayer
};

L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(map);

map.on('overlayadd', function(e) {
  if (e.layer === dbSmsLayer) {
    window.open('https://kort.dyrenesbeskyttelse.dk/db/dvc.nsf/kort', '_blank');
    map.removeLayer(dbSmsLayer);
  } else if (e.layer === dbJournalLayer) {
    window.open('https://dvc.dyrenesbeskyttelse.dk/db/dvc.nsf/Efter%20journalnr?OpenView', '_blank');
    map.removeLayer(dbJournalLayer);
  } else if (e.layer === chargeMapLayer) {
    if (!selectedRadius) {
      alert("Vælg radius først");
      chargeMapLayer.clearLayers();
      return;
    }

    chargeMapLayer.clearLayers();
    const center = currentMarker.getLatLng();
    const lat = center.lat, lon = center.lng;
    const distKm = selectedRadius / 1000;

    fetch(
      'https://api.openchargemap.io/v3/poi/?output=json' +
      '&countrycode=DK' +
      '&maxresults=10000' +
      `&latitude=${lat}` +
      `&longitude=${lon}` +
      `&distance=${distKm}` +
      `&distanceunit=KM` +
      '&key=3c33b286-7067-426b-8e46-a727dd12f6f3'
    )
    .then(r => r.json())
    .then(data => {
      data.forEach(point => {
        const lat = point.AddressInfo?.Latitude;
        const lon = point.AddressInfo?.Longitude;
        if (lat && lon && currentMarker &&
            map.distance(currentMarker.getLatLng(), L.latLng(lat, lon)) <= selectedRadius) {
          L.circleMarker([lat, lon], {
            radius: 8,
            color: 'yellow',
            fillColor: 'yellow',
            fillOpacity: 1
          })
          .bindPopup(/* din popup-kode her */)
          .addTo(chargeMapLayer);
        }
      });
    })
    .catch(err => console.error('Fejl ved hentning af ladestandere:', err));
  }
});

L.control.zoom({ position: 'bottomright' }).addTo(map);

var currentMarker;

/***************************************************
 * Kommunedata hentet fra "Kommuner.xlsx"
 ***************************************************/
let kommuneInfo = {};

fetch("kommunedata.json")
  .then(r => r.json())
  .then(data => {
    kommuneInfo = data;
    console.log("Kommunedata indlæst:", kommuneInfo);
  })
  .catch(err => console.error("Fejl ved hentning af kommunedata:", err));


/***************************************************
 * Ny hjælpefunktion: Nulstil koordinatboksen
 ***************************************************/
function resetCoordinateBox() {
  const coordinateBox = document.getElementById("coordinateBox");
  coordinateBox.textContent = "";
  coordinateBox.style.display = "none";
}

/***************************************************
 * Ny hjælpefunktion: Sæt koordinatboksen med kopiering
 ***************************************************/
function setCoordinateBox(lat, lon) {
  const coordinateBox = document.getElementById("coordinateBox");
  let latFixed = lat.toFixed(6);
  let lonFixed = lon.toFixed(6);
  coordinateBox.innerHTML = `
    Koordinater: 
    <span id="latVal">${latFixed}</span>, 
    <span id="lonVal">${lonFixed}</span>
  `;
  coordinateBox.style.display = "block";
  const latSpan = document.getElementById("latVal");
  const lonSpan = document.getElementById("lonVal");
  function handleCoordClick() {
    latSpan.style.color = "red";
    lonSpan.style.color = "red";
    const coordsToCopy = `${latFixed},${lonFixed}`;
    navigator.clipboard.writeText(coordsToCopy)
      .then(() => {
        console.log("Copied coords:", coordsToCopy);
      })
      .catch(err => console.error("Could not copy coords:", err));
    setTimeout(() => {
      latSpan.style.color = "";
      lonSpan.style.color = "";
    }, 1000);
  }
  latSpan.addEventListener("click", handleCoordClick);
  lonSpan.addEventListener("click", handleCoordClick);
}

/***************************************************
 * Global variabel og funktioner til Strandposter-søgning
 ***************************************************/
var allStrandposter = [];
var strandposterReady = false;
function fetchAllStrandposter() {
  const localUrl = "Strandposter";
  console.log("Henter alle strandposter fra lokal fil:", localUrl);
  return fetch(localUrl)
    .then(resp => resp.json())
    .then(geojson => {
      if (geojson.features) {
        allStrandposter = geojson.features;
        strandposterReady = true;
        console.log("Alle strandposter hentet fra lokal fil:", allStrandposter);
        setLastUpdated();
      } else {
        console.warn("Ingen strandposter modtaget fra lokal fil.");
      }
    })
    .catch(err => {
      console.error("Fejl ved hentning af lokal strandposter-fil:", err);
    });
}
map.on("overlayadd", function(event) {
  if (event.name === "Strandposter") {
    console.log("Strandposter laget er tilføjet.");

    // Hent altid data ved første aktivering, eller hvis der ikke er nogen gemt endnu
    if (allStrandposter.length === 0) {
      console.log("Henter strandposter-data første gang...");
      fetchAllStrandposter();
    } else {
      console.log("Strandposter-data allerede hentet.");
    }
  }
});

/***************************************************
 * Klik på kort => reverse geocoding => opdater sidepanelet
 ***************************************************/
map.on('click', function(e) {
  let lat = e.latlng.lat;
  let lon = e.latlng.lng;
  if (currentMarker) {
    map.removeLayer(currentMarker);
  }
  currentMarker = L.marker([lat, lon]).addTo(map);
  setCoordinateBox(lat, lon);
  let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${lon}&y=${lat}&struktur=flad`;
  fetch(revUrl)
    .then(r => r.json())
    .then(data => {
      updateInfoBox(data, lat, lon);
    })
    .catch(err => console.error("Reverse geocoding fejl:", err));
});

/***************************************************
 * updateInfoBox
 * Viser fuld adresse, Eva.Net/Notes-links i infobox,
 * Viser kommunekode/vejkode i overlay
 ***************************************************/
async function updateInfoBox(data, lat, lon) {
  const streetviewLink = document.getElementById("streetviewLink");
  const addressEl      = document.getElementById("address");
  const extraInfoEl    = document.getElementById("extra-info");
  const skråfotoLink   = document.getElementById("skraafotoLink");
  const overlay        = document.getElementById("kommuneOverlay");
  
  let adresseStr, vejkode, kommunekode;
  let evaFormat, notesFormat;
  
  if(data.adgangsadresse){
    adresseStr = data.adgangsadresse.adressebetegnelse || 
                 `${data.adgangsadresse.vejnavn || ""} ${data.adgangsadresse.husnr || ""}, ${data.adgangsadresse.postnr || ""} ${data.adgangsadresse.postnrnavn || ""}`;
    evaFormat   = `${data.adgangsadresse.vejnavn || ""},${data.adgangsadresse.husnr || ""},${data.adgangsadresse.postnr || ""}`;
    notesFormat = `${data.adgangsadresse.vejnavn || ""} ${data.adgangsadresse.husnr || ""}, ${data.adgangsadresse.postnr || ""} ${data.adgangsadresse.postnrnavn || ""}`;
    vejkode     = data.adgangsadresse.vejkode || "?";
    kommunekode = data.adgangsadresse.kommunekode || "?";
  } else if(data.adressebetegnelse) {
    adresseStr  = data.adressebetegnelse;
    evaFormat   = "?, ?, ?";
    notesFormat = "?, ?, ?";
    vejkode     = data.vejkode     || "?";
    kommunekode = data.kommunekode || "?";
  } else {
    adresseStr  = `${data.vejnavn || "?"} ${data.husnr || ""}, ${data.postnr || "?"} ${data.postnrnavn || ""}`;
    evaFormat   = `${data.vejnavn || ""},${data.husnr || ""},${data.postnr || ""}`;
    notesFormat = `${data.vejnavn || ""} ${data.husnr || ""}, ${data.postnr || ""} ${data.postnrnavn || ""}`;
    vejkode     = data.vejkode     || "?";
    kommunekode = data.kommunekode || "?";
  }
  
  streetviewLink.href = `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lon}`;
  addressEl.textContent = adresseStr;

  // nulstil og genopbyg extraInfoEl
  extraInfoEl.innerHTML = "";
  // Tilføj Eva.Net/Notes-links uden et ekstra linjeskift før dem. Det fjernede <br> var årsag til en tom linje i infoboksen.
  extraInfoEl.insertAdjacentHTML(
    "beforeend",
    `
    <a href="#" title="Kopier til Eva.net" onclick="(function(el){ el.style.color='red'; copyToClipboard('${evaFormat}'); showCopyPopup('Kopieret'); setTimeout(function(){ el.style.color=''; },1000); })(this); return false;">Eva.Net</a>
    &nbsp;
    <a href="#" title="Kopier til Notes" onclick="(function(el){ el.style.color='red'; copyToClipboard('${notesFormat}'); showCopyPopup('Kopieret'); setTimeout(function(){ el.style.color=''; },1000); })(this); return false;">Notes</a>`
  );
  
  skråfotoLink.href = `https://skraafoto.dataforsyningen.dk/?search=${encodeURIComponent(adresseStr)}`;
  skråfotoLink.style.display = "inline";
  skråfotoLink.onclick = function(e) {
    e.preventDefault();
    copyToClipboard(adresseStr);
    let msg = document.createElement("div");
    msg.textContent = "Adressen er kopieret til udklipsholder.";
    msg.style.position = "fixed";
    msg.style.top = "20px";
    msg.style.left = "50%";
    msg.style.transform = "translateX(-50%)";
    msg.style.background = "rgba(0,0,0,0.7)";
    msg.style.color = "white";
    msg.style.padding = "10px 15px";
    msg.style.borderRadius = "5px";
    msg.style.zIndex = "1000";
    document.body.appendChild(msg);
    setTimeout(function() {
      document.body.removeChild(msg);
      window.open(skråfotoLink.href, '_blank');
    }, 1000);
  };

  overlay.textContent = `Kommunekode: ${kommunekode} | Vejkode: ${vejkode}`;
  overlay.style.display = "block";

  if (resultsList) resultsList.innerHTML = "";
  if (vej1List)    vej1List.innerHTML    = "";
  if (vej2List)    vej2List.innerHTML    = "";

  // Statsvej-data
  let statsvejData = await checkForStatsvej(lat, lon);
  const statsvejInfoEl = document.getElementById("statsvejInfo");

  // Udtræk felter med både store og små bogstaver
  const admNr       = statsvejData?.ADM_NR       ?? statsvejData?.adm_nr       ?? null;
  const forgrening  = statsvejData?.FORGRENING   ?? statsvejData?.forgrening   ?? null;
  const betegnelse  = statsvejData?.BETEGNELSE   ?? statsvejData?.betegnelse   ?? null;
  const bestyrer    = statsvejData?.BESTYRER     ?? statsvejData?.bestyrer     ?? null;
  const vejtype     = statsvejData?.VEJTYPE      ?? statsvejData?.vejtype      ?? null;
  const beskrivelse = statsvejData?.BESKRIVELSE  ?? statsvejData?.beskrivelse  ?? null;
  const vejstatus   = statsvejData?.VEJSTATUS    ?? statsvejData?.vejstatus    ?? statsvejData?.VEJ_STATUS ?? statsvejData?.status ?? null;
  const vejmynd     = statsvejData?.VEJMYNDIGHED ?? statsvejData?.vejmyndighed ?? statsvejData?.VEJMYND     ?? statsvejData?.vejmynd ?? null;
  
  // afgør om vi har en statsvej
  const hasStatsvej = admNr != null || forgrening != null || (betegnelse && String(betegnelse).trim() !== "") || (vejtype && String(vejtype).trim() !== "");
  const showStatsBox = hasStatsvej || vejstatus || vejmynd;

  if (showStatsBox) {
    let html = "";
    if (hasStatsvej) {
      html += `<strong>Administrativt nummer:</strong> ${admNr || "Ukendt"}<br>`;
      html += `<strong>Forgrening:</strong> ${forgrening || "Ukendt"}<br>`;
      html += `<strong>Vejnavn:</strong> ${betegnelse || "Ukendt"}<br>`;
      html += `<strong>Bestyrer:</strong> ${bestyrer || "Ukendt"}<br>`;
      html += `<strong>Vejtype:</strong> ${vejtype || "Ukendt"}`;
    }
    // Beskrivelse vises ikke længere i statsvej-info-boksen

    if (vejstatus) {
      html += `<br><strong>Vejstatus:</strong> ${vejstatus}`;
    }
    if (vejmynd) {
      html += `<br><strong>Vejmyndighed:</strong> ${vejmynd}`;
    }
    statsvejInfoEl.innerHTML = html;
    // hent kilometermarkering kun hvis der er en statsvej
    if (hasStatsvej) {
      const kmText = await getKmAtPoint(lat, lon);
      if (kmText) {
        statsvejInfoEl.innerHTML += `<br><strong>Km:</strong> ${kmText}`;
      }
    }
    document.getElementById("statsvejInfoBox").style.display = "block";
  } else {
    statsvejInfoEl.innerHTML = "";
    document.getElementById("statsvejInfoBox").style.display = "none";
  }
  document.getElementById("infoBox").style.display = "block";
  
  // Hent kommuneinfo
  if (kommunekode !== "?") {
    try {
      let komUrl = `https://api.dataforsyningen.dk/kommuner/${kommunekode}`;
      let komResp = await fetch(komUrl);
      if (komResp.ok) {
        let komData = await komResp.json();
        let kommunenavn = komData.navn || "";
        if (kommunenavn && kommuneInfo[kommunenavn]) {
          let info      = kommuneInfo[kommunenavn];
          let doedeDyr  = info["Døde dyr"];
          let gaderVeje = info["Gader og veje"];
          let link      = info.gemLink;
          if (link) {
            // Vis kommuneoplysninger med større skrifttype; samlet på én linje for at sikre stilen anvendes korrekt
            extraInfoEl.innerHTML += `<br><span style="font-size:16px;">Kommune: <a href="${link}" target="_blank">${kommunenavn}</a> | Døde dyr: ${doedeDyr} | Gader og veje: ${gaderVeje}</span>`;
          } else {
            extraInfoEl.innerHTML += `<br><span style="font-size:16px;">Kommune: ${kommunenavn} | Døde dyr: ${doedeDyr} | Gader og veje: ${gaderVeje}</span>`;
          }
        }
      }
    } catch (e) {
      console.error("Kunne ikke hente kommuneinfo:", e);
    }
  }
  
  // Politikkreds – tilføjes hvis tilgængelig
  const politikredsNavn = data.politikredsnavn
    ?? data.adgangsadresse?.politikredsnavn
    ?? null;
  const politikredsKode = data.politikredskode
    ?? data.adgangsadresse?.politikredskode
    ?? null;
  if (politikredsNavn || politikredsKode) {
    const polititekst = politikredsKode ? `${politikredsNavn || ""} (${politikredsKode})` : `${politikredsNavn}`;
    // Vis politikreds med større skrifttype og på egen linje
    extraInfoEl.innerHTML += `<br><span style="font-size:16px;">Politikreds: ${polititekst}</span>`;
  }

  // Juster placeringen af statsvej-boksen, så den flyttes ned under info-boksen uanset højde
  try {
    const infoBoxEl = document.getElementById("infoBox");
    const statsBoxEl = document.getElementById("statsvejInfoBox");
    if (infoBoxEl && statsBoxEl) {
      // brug lidt mere afstand mellem boksene (16px)
      const spacing = 6;
      // beregn ny top-position relativt til statsBoxEl's offsetParent
      const infoRect = infoBoxEl.getBoundingClientRect();
      const parentRect = statsBoxEl.offsetParent?.getBoundingClientRect() ?? { top: 0 };
      // bottom of infoBox relative to viewport minus offsetParent top gives relative top within parent
      const newTop = infoRect.bottom - parentRect.top + spacing;
      statsBoxEl.style.top = `${newTop}px`;
    }
  } catch (err) {
    console.warn('Kunne ikke justere statsvej-boksens placering:', err);
  }
}

/***************************************************
 * Søgefelter og lister
 ***************************************************/
var searchInput  = document.getElementById("search");
var clearBtn     = document.getElementById("clearSearch");
var resultsList  = document.getElementById("results");
var vej1Input    = document.getElementById("vej1");
var vej2Input    = document.getElementById("vej2");
var vej1List     = document.getElementById("results-vej1");
var vej2List     = document.getElementById("results-vej2");

function addClearButton(inputElement, listElement) {
  let btn = document.createElement("span");
  btn.innerHTML = "&times;";
  btn.classList.add("clear-button");
  inputElement.parentElement.appendChild(btn);
  inputElement.addEventListener("input", function () {
    btn.style.display = inputElement.value.length > 0 ? "inline" : "none";
  });
  btn.addEventListener("click", function () {
    inputElement.value = "";
    listElement.innerHTML = "";
    btn.style.display = "none";
    resetCoordinateBox();
  });
  inputElement.addEventListener("keydown", function (e) {
    if (e.key === "Backspace" && inputElement.value.length === 0) {
      listElement.innerHTML = "";
      resetCoordinateBox();
    }
  });
  btn.style.display = "none";
}
addClearButton(vej1Input, vej1List);
addClearButton(vej2Input, vej2List);

/***************************************************
 * Globale arrays til piletaster
 ***************************************************/
var searchItems = [];
var searchCurrentIndex = -1;
var vej1Items = [];
var vej1CurrentIndex = -1;
var vej2Items = [];
var vej2CurrentIndex = -1;

/***************************************************
 * #search => doSearch
 * Vigtigt: detail-kald hver gang
 ***************************************************/
searchInput.addEventListener("input", function() {
  // Når der tastes i søgefeltet, fjern eventuelle eksisterende info-bokse,
  // statsvej-bokse og markører. Dette sikrer, at tidligere søgninger ikke
  // overlapper med nye resultater.
  document.getElementById("infoBox").style.display = "none";
  document.getElementById("statsvejInfoBox").style.display = "none";
  // Fjern eventuel marker og nulstil koordinatboks
  if (currentMarker) {
    map.removeLayer(currentMarker);
    currentMarker = null;
  }
  resetCoordinateBox();

  const txt = searchInput.value.trim();
  if (txt.length < 2) {
    clearBtn.style.display = "none";
    resultsList.innerHTML = "";
    document.getElementById("infoBox").style.display = "none";
    searchItems = [];
    return;
  }
  clearBtn.style.display = "inline";
  doSearch(txt, resultsList);
  
  // Tjek om brugeren har indtastet koordinater
  const coordRegex = /^(-?\d+(?:\.\d+))\s*,\s*(-?\d+(?:\.\d+))$/;
  if (coordRegex.test(txt)) {
    const match = txt.match(coordRegex);
    const latNum = parseFloat(match[1]);
    const lonNum = parseFloat(match[2]);
    let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${lonNum}&y=${latNum}&struktur=flad`;
    fetch(revUrl)
      .then(r => r.json())
      .then(data => {
        resultsList.innerHTML = "";
        placeMarkerAndZoom([latNum, lonNum], `Koordinater: ${latNum.toFixed(5)}, ${lonNum.toFixed(5)}`);
        setCoordinateBox(latNum, lonNum);
        updateInfoBox(data, latNum, lonNum);
      })
      .catch(err => console.error("Reverse geocoding fejl:", err));
    return;
  }
});

/***************************************************
 * Piletaster + Enter i søgefeltet
 ***************************************************/
searchInput.addEventListener("keydown", function(e) {
  if (searchItems.length === 0) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    searchCurrentIndex = (searchCurrentIndex + 1) % searchItems.length;
    highlightSearchItem();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    searchCurrentIndex = (searchCurrentIndex + searchItems.length - 1) % searchItems.length;
    highlightSearchItem();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (searchCurrentIndex >= 0) {
      searchItems[searchCurrentIndex].click();
    }
  } else if (e.key === "Backspace") {
    if (searchInput.value.length === 0) {
      resetCoordinateBox();
    }
  }
});

function highlightSearchItem() {
  searchItems.forEach(li => li.classList.remove("highlight"));
  if (searchCurrentIndex >= 0 && searchCurrentIndex < searchItems.length) {
    searchItems[searchCurrentIndex].classList.add("highlight");
  }
}

clearBtn.addEventListener("click", function() {
  resetInfoBox();
});

/***************************************************
 * Vej1 => doSearchRoad + piletaster
 ***************************************************/
vej1Input.addEventListener("input", function() {
  const txt = vej1Input.value.trim();
  if (txt.length < 2) {
    vej1List.innerHTML = "";
    vej1List.style.display = "none";
    vej1Items = [];
    return;
  }
  doSearchRoad(txt, vej1List, vej1Input, "vej1");
});
vej1Input.addEventListener("keydown", function(e) {
  if (e.key === "Backspace") {
    document.getElementById("infoBox").style.display = "none";
  }
  if (vej1Items.length === 0) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    vej1CurrentIndex = (vej1CurrentIndex + 1) % vej1Items.length;
    highlightVej1Item();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    vej1CurrentIndex = (vej1CurrentIndex + vej1Items.length - 1) % vej1Items.length;
    highlightVej1Item();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (vej1CurrentIndex >= 0) {
      vej1Items[vej1CurrentIndex].click();
    }
  }
});
function highlightVej1Item() {
  vej1Items.forEach(li => li.classList.remove("highlight"));
  if (vej1CurrentIndex >= 0 && vej1CurrentIndex < vej1Items.length) {
    vej1Items[vej1CurrentIndex].classList.add("highlight");
  }
}

/***************************************************
 * Vej2 => doSearchRoad + piletaster
 ***************************************************/
vej2Input.addEventListener("input", function() {
  const txt = vej2Input.value.trim();
  if (txt.length < 2) {
    vej2List.innerHTML = "";
    vej2List.style.display = "none";
    vej2Items = [];
    return;
  }
  doSearchRoad(txt, vej2List, vej2Input, "vej2");
});
vej2Input.addEventListener("keydown", function(e) {
  document.getElementById("infoBox").style.display = "none";
  if (vej2Items.length === 0) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    vej2CurrentIndex = (vej2CurrentIndex + 1) % vej2Items.length;
    highlightVej2Item();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    vej2CurrentIndex = (vej2CurrentIndex + vej2Items.length - 1) % vej2Items.length;
    highlightVej2Item();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (vej2CurrentIndex >= 0) {
      vej2Items[vej2CurrentIndex].click();
    }
  } else if (e.key === "Backspace") {
    if (vej2Input.value.length === 0) {
      resetCoordinateBox();
    }
  }
});
function highlightVej2Item() {
  vej2Items.forEach(li => li.classList.remove("highlight"));
  if (vej2CurrentIndex >= 0 && vej2CurrentIndex < vej2Items.length) {
    vej2Items[vej2CurrentIndex].classList.add("highlight");
  }
}

/***************************************************
 * Klik på clear-knap => ryd
 ***************************************************/
clearBtn.addEventListener("click", function() {
  searchInput.value = "";
  clearBtn.style.display = "none";
  document.getElementById("infoBox").style.display = "none";
  document.getElementById("statsvejInfoBox").style.display = "none";
  resetCoordinateBox();
  resetInfoBox();
  searchInput.focus();
  if (currentMarker) {
    map.removeLayer(currentMarker);
    currentMarker = null;
  }
  resultsList.innerHTML = "";
  document.getElementById("kommuneOverlay").style.display = "none";
});

function resetInfoBox() {
  document.getElementById("extra-info").textContent = "";
  document.getElementById("skraafotoLink").style.display = "none";
}

vej1Input.parentElement.querySelector(".clear-button").addEventListener("click", function() {
  vej1Input.value = "";
  vej1List.innerHTML = "";
  document.getElementById("infoBox").style.display = "none";
  resetCoordinateBox();
});

vej2Input.parentElement.querySelector(".clear-button").addEventListener("click", function() {
  vej2Input.value = "";
  vej2List.innerHTML = "";
  document.getElementById("infoBox").style.display = "none";
  resetCoordinateBox();
});

/***************************************************
 * Globale variabler til at gemme valgte veje
 ***************************************************/
var selectedRoad1 = null;
var selectedRoad2 = null;

/***************************************************
 * doSearchRoad => bruges af vej1/vej2
 ***************************************************/
function doSearchRoad(query, listElement, inputField, which) {
  let addrUrl = `https://api.dataforsyningen.dk/adgangsadresser/autocomplete?q=${encodeURIComponent(query)}&per_side=10`;
  fetch(addrUrl)
    .then(response => response.json())
    .then(data => {
      listElement.innerHTML = "";
      if (which === "vej1") {
        vej1Items = [];
        vej1CurrentIndex = -1;
      } else {
        vej2Items = [];
        vej2CurrentIndex = -1;
      }
      data.sort((a, b) => a.tekst.localeCompare(b.tekst));
      const unique = new Set();
      data.forEach(item => {
        let vejnavn   = item.adgangsadresse?.vejnavn || "Ukendt vej";
        let kommune   = item.adgangsadresse?.postnrnavn || "Ukendt kommune";
        let postnr    = item.adgangsadresse?.postnr || "?";
        let adgangsId = item.adgangsadresse?.id || null;
        let key = `${vejnavn}-${postnr}`;
        if (unique.has(key)) return;
        unique.add(key);
        let li = document.createElement("li");
        li.textContent = `${vejnavn}, ${kommune} (${postnr})`;
        li.addEventListener("click", function() {
          inputField.value = vejnavn;
          listElement.innerHTML = "";
          listElement.style.display = "none";
          if (!adgangsId) {
            console.error("Ingen adgangsadresse.id => kan ikke slå vejkode op");
            return;
          }
          let detailUrl = `https://api.dataforsyningen.dk/adgangsadresser/${adgangsId}?struktur=mini`;
          fetch(detailUrl)
            .then(r => r.json())
            .then(async detailData => {
              let roadSelection = {
                vejnavn: vejnavn,
                kommunekode: detailData.kommunekode,
                vejkode: detailData.vejkode,
                husnummerId: detailData.id
              };
              let geometry = await getNavngivenvejKommunedelGeometry(detailData.id);
              roadSelection.geometry = geometry;
              if (inputField.id === "vej1") {
                selectedRoad1 = roadSelection;
              } else if (inputField.id === "vej2") {
                selectedRoad2 = roadSelection;
              }
            })
            .catch(err => {
              console.error("Fejl i fetch /adgangsadresser/{id}:", err);
            });
        });
        listElement.appendChild(li);
        if (which === "vej1") {
          vej1Items.push(li);
        } else {
          vej2Items.push(li);
        }
      });
      listElement.style.display = data.length > 0 ? "block" : "none";
    })
    .catch(err => console.error("Fejl i doSearchRoad:", err));
}

/***************************************************
 * doSearchStrandposter => klient-side søgning
 ***************************************************/
function doSearchStrandposter(query) {
  query = query.toLowerCase();
  return new Promise((resolve, reject) => {
    function filterAndMap() {
      let results = allStrandposter.filter(feature => {
        let rednr = (feature.properties.StrandNr || "").toLowerCase();
        return rednr.indexOf(query) !== -1;
      }).map(feature => {
        let rednr = feature.properties.StrandNr;
        let tekst = `Redningsnummer: ${rednr}`;
        let coords = feature.geometry.coordinates;
        let lat, lon;
        if (coords[0] > 90 || coords[1] > 90) {
          let converted = convertToWGS84(coords[0], coords[1]);
          lat = converted[0];
          lon = converted[1];
        } else {
          lon = coords[0];
          lat = coords[1];
        }
        return {
          type: "strandpost",
          tekst: tekst,
          lat: lat,
          lon: lon,
          feature: feature
        };
      });
      resolve(results);
    }
    if (allStrandposter.length === 0) {
      fetchAllStrandposter().then(filterAndMap).catch(err => {
        console.error("Fejl ved hentning af strandposter:", err);
        resolve([]);
      });
    } else {
      filterAndMap();
    }
  });
}

/***************************************************
 * doSearch => kombinerer adresser, stednavne, specialsteder og strandposter
 ***************************************************/
function doSearch(query, listElement) {
  let addrUrl = `https://api.dataforsyningen.dk/adgangsadresser/autocomplete?q=${encodeURIComponent(query)}`;
  let stedUrl = `https://api.dataforsyningen.dk/rest/gsearch/v2.0/stednavn?q=${encodeURIComponent(query)}&limit=100&token=a63a88838c24fc85d47f32cde0ec0144`;
  // Navngivne veje: søg i officielle vejnavne via Dataforsyningen. Ved at
  // sætte per_side begrænses antal resultater. For at understøtte
  // autocomplete/partial matches tilføjes wildcard * efter hvert ord.
  const queryWithWildcard = query.trim().split(/\s+/).map(w => w + "*").join(" ");
  let roadUrl = `https://api.dataforsyningen.dk/navngivneveje?q=${encodeURIComponent(queryWithWildcard)}&per_side=20`;
  // Kun indlæs strandposter hvis laget er tændt og data er klar
  let strandPromise = (map.hasLayer(redningsnrLayer) && strandposterReady)
    ? doSearchStrandposter(query)
    : Promise.resolve([]);
  
  // Specialsteder: filtrer customPlaces efter query
  let customResults = customPlaces
    .filter(p => p.navn.toLowerCase().includes(query.toLowerCase()))
    .map(p => ({
      type: "custom",
      navn: p.navn,
      coords: p.coords
    }));

  Promise.all([
    fetch(addrUrl).then(r => r.json()).catch(err => { console.error("Adresser fejl:", err); return []; }),
    fetch(stedUrl).then(r => r.json()).catch(err => { console.error("Stednavne fejl:", err); return {}; }),
    fetch(roadUrl).then(r => r.json()).catch(err => { console.error("Navngivne veje fejl:", err); return []; }),
    strandPromise
  ])
  .then(([addrData, stedData, roadData, strandData]) => {
    listElement.innerHTML = "";
    searchItems = [];
    searchCurrentIndex = -1;
    let addrResults = (addrData || []).map(item => ({
      type: "adresse",
      tekst: item.tekst,
      adgangsadresse: item.adgangsadresse
    }));
    let stedResults = [];
    if (stedData) {
      if (Array.isArray(stedData.results)) {
        stedResults = stedData.results.map(result => ({
          type: "stednavn",
          navn: result.visningstekst || result.navn,
          bbox: result.bbox || null,
          geometry: result.geometry
        }));
      } else if (Array.isArray(stedData)) {
        stedResults = stedData.map(result => ({
          type: "stednavn",
          navn: result.visningstekst || result.skrivemaade_officiel,
          bbox: result.bbox || null,
          geometry: result.geometri
        }));
      }
    }
    // Navngivne veje resultater (vejnavne)
    let roadResults = (roadData || []).map(item => ({
      type: "navngivenvej",
      navn: item.navn || item.adresseringsnavn || "",
      id: item.id,
      visualCenter: item.visueltcenter,
      bbox: item.bbox
    }));
    // Kombiner alle resultater inkl. specialsteder og navngivne veje
    let combined = [...addrResults, ...stedResults, ...roadResults, ...strandData, ...customResults];
    combined.sort((a, b) => {
      // Prioriter stednavne, navngivne veje og specialsteder over adresser
      const aIsName = (a.type === "stednavn" || a.type === "navngivenvej" || a.type === "custom");
      const bIsName = (b.type === "stednavn" || b.type === "navngivenvej" || b.type === "custom");
      if (aIsName && !bIsName) return -1;
      if (!aIsName && bIsName) return 1;
      return getSortPriority(a, query) - getSortPriority(b, query);
    });
    combined.forEach(obj => {
      let li = document.createElement("li");
      if (obj.type === "strandpost") {
        li.innerHTML = `🛟 ${obj.tekst}`;
      } else if (obj.type === "adresse") {
        li.innerHTML = `🏠 ${obj.tekst}`;
      } else if (obj.type === "navngivenvej") {
        // brug vej‑ikon til navngivne veje
        li.innerHTML = `🛣️ ${obj.navn}`;
      } else if (obj.type === "stednavn" || obj.type === "custom") {
        // brug pin‑ikon for stednavne og specialsteder
        li.innerHTML = `📍 ${obj.navn}`;
      }
      li.addEventListener("click", function() {
        if (obj.type === "adresse" && obj.adgangsadresse && obj.adgangsadresse.id) {
          fetch(`https://api.dataforsyningen.dk/adgangsadresser/${obj.adgangsadresse.id}`)
            .then(r => r.json())
            .then(addressData => {
              let [lon, lat] = addressData.adgangspunkt.koordinater;
              setCoordinateBox(lat, lon);
              placeMarkerAndZoom([lat, lon], obj.tekst);
              let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${lon}&y=${lat}&struktur=flad`;
              fetch(revUrl)
                .then(r => r.json())
                .then(reverseData => {
                  updateInfoBox(reverseData, lat, lon);
                })
                .catch(err => console.error("Reverse geocoding fejl:", err));
              updateInfoBox(addressData, lat, lon);
              resultsList.innerHTML = "";
              vej1List.innerHTML = "";
              vej2List.innerHTML = "";
            })
            .catch(err => console.error("Fejl i /adgangsadresser/{id}:", err));
        } else if (obj.type === "stednavn" && obj.bbox && obj.bbox.coordinates && obj.bbox.coordinates[0] && obj.bbox.coordinates[0].length > 0) {
          let [x, y] = obj.bbox.coordinates[0][0];
          placeMarkerAndZoom([x, y], obj.navn);
          listElement.innerHTML = "";
          listElement.style.display = "none";
        } else if (obj.type === "stednavn" && obj.geometry && obj.geometry.coordinates) {
          let coordsArr = Array.isArray(obj.geometry.coordinates[0])
                          ? obj.geometry.coordinates[0]
                          : obj.geometry.coordinates;
          placeMarkerAndZoom(coordsArr, obj.navn);
          listElement.innerHTML = "";
          listElement.style.display = "none"; 
        } else if (obj.type === "strandpost") {
          setCoordinateBox(obj.lat, obj.lon);
          placeMarkerAndZoom([obj.lat, obj.lon], obj.tekst);
          listElement.innerHTML = "";
          listElement.style.display = "none"; 
          let marker = currentMarker;
          let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${obj.lon}&y=${obj.lat}&struktur=flad`;
          fetch(revUrl)
            .then(r => r.json())
            .then(revData => {
              const vejnavn     = revData?.adgangsadresse?.vejnavn     || revData?.vejnavn || "?";
              const husnr       = revData?.adgangsadresse?.husnr       || revData?.husnr   || "";
              const postnr      = revData?.adgangsadresse?.postnr      || revData?.postnr  || "?";
              const postnrnavn  = revData?.adgangsadresse?.postnrnavn  || revData?.postnrnavn || "";
              const adresseStr  = `${vejnavn} ${husnr}, ${postnr} ${postnrnavn}`;
              const evaFormat   = `${vejnavn},${husnr},${postnr}`;
              const notesFormat = `${vejnavn} ${husnr}, ${postnr} ${postnrnavn}`;
              marker.bindPopup(`
                <strong>${obj.tekst}</strong><br>
                ${adresseStr}<br>
                <a href="#" title="Kopier til Eva.net" onclick="(function(el){ el.style.color='red'; copyToClipboard('${evaFormat}'); showCopyPopup('Kopieret'); setTimeout(function(){ el.style.color=''; },1000); })(this); return false;">Eva.Net</a>
                &nbsp;
                <a href="#" title="Kopier til Notes" onclick="(function(el){ el.style.color='red'; copyToClipboard('${notesFormat}'); showCopyPopup('Kopieret'); setTimeout(function(){ el.style.color=''; },1000); })(this); return false;">Notes</a>
              `).openPopup();
              marker.on("popupclose", function () {
                map.removeLayer(marker);
                currentMarker = null;
                document.getElementById("infoBox").style.display = "none";
                document.getElementById("statsvejInfoBox").style.display = "none";
                resetCoordinateBox();
                resultsList.innerHTML = "";
              });
            })
            .catch(err => {
              console.error("Reverse geocoding for strandpost fejlede:", err);
              marker.bindPopup(`<strong>${obj.tekst}</strong><br>(Reverse geocoding fejlede)`).openPopup();
            });
        } else if (obj.type === "custom") {
          // specialsteder som Tellerup Bjerge
          let [lat, lon] = obj.coords;
          setCoordinateBox(lat, lon);
          placeMarkerAndZoom([lat, lon], obj.navn);
          // Reverse geocoding for at vise nærmeste adresse i infoboksen
          let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${lon}&y=${lat}&struktur=flad`;
          fetch(revUrl)
            .then(r => r.json())
            .then(revData => {
              updateInfoBox(revData, lat, lon);
            })
            .catch(err => console.error("Reverse geocoding fejl for specialsted:", err));
          listElement.innerHTML = "";
          listElement.style.display = "none";
        } else if (obj.type === "navngivenvej") {
          // Navngiven vej: brug visuelt center til at placere markør
          let lat, lon;
          if (Array.isArray(obj.visualCenter) && obj.visualCenter.length === 2) {
            lon = obj.visualCenter[0];
            lat = obj.visualCenter[1];
          } else if (Array.isArray(obj.bbox) && obj.bbox.length === 4) {
            // hvis visuelt center mangler, brug midtpunkt af bbox
            const [minLon, minLat, maxLon, maxLat] = obj.bbox;
            lon = (minLon + maxLon) / 2;
            lat = (minLat + maxLat) / 2;
          } else {
            // fallback: ignorer
            return;
          }
          setCoordinateBox(lat, lon);
          placeMarkerAndZoom([lat, lon], obj.navn);
          // Reverse geocoding til nærmeste adresse
          let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${lon}&y=${lat}&struktur=flad`;
          fetch(revUrl)
            .then(r => r.json())
            .then(revData => {
              updateInfoBox(revData, lat, lon);
            })
            .catch(err => console.error("Reverse geocoding fejl for navngiven vej:", err));
          listElement.innerHTML = "";
          listElement.style.display = "none";
        }
      });
      listElement.appendChild(li);
      searchItems.push(li);
    });
    listElement.style.display = combined.length > 0 ? "block" : "none";
  })
  .catch(err => console.error("Fejl i doSearch:", err));
}

/***************************************************
 * getNavngivenvejKommunedelGeometry
 ***************************************************/
async function getNavngivenvejKommunedelGeometry(husnummerId) {
  let url = `https://services.datafordeler.dk/DAR/DAR/3.0.0/rest/navngivenvejkommunedel?husnummer=${husnummerId}&MedDybde=true&format=json`;
  try {
    let r = await fetch(url);
    let data = await r.json();
    if (Array.isArray(data) && data.length > 0) {
      let first = data[0];
      if (first.navngivenVej && first.navngivenVej.vejnavnebeliggenhed_vejnavnelinje) {
        let wktString = first.navngivenVej.vejnavnebeliggenhed_vejnavnelinje;
        let geojson = wellknown.parse(wktString);
        return geojson;
      }
    }
  } catch (err) {
    console.error("Fejl i getNavngivenvejKommunedelGeometry:", err);
  }
  return null;
}

/***************************************************
 * placeMarkerAndZoom
 ***************************************************/
function placeMarkerAndZoom(coords, displayText) {
  if (coords[0] > 90 || coords[1] > 90) {
    let converted = convertToWGS84(coords[0], coords[1]);
    coords = converted;
  }
  let lat = coords[0], lon = coords[1];
  if (currentMarker) {
    map.removeLayer(currentMarker);
  }
  currentMarker = L.marker([lat, lon]).addTo(map);
  map.setView([lat, lon], 16);
  document.getElementById("address").textContent = displayText;
  const streetviewLink = document.getElementById("streetviewLink");
  streetviewLink.href = `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lon}`;
  document.getElementById("infoBox").style.display = "block";
}

/***************************************************
 * checkForStatsvej => henter statsvej (Geocloud)
 ***************************************************/
async function checkForStatsvej(lat, lon) {
  let [utmX, utmY] = proj4("EPSG:4326", "EPSG:25832", [lon, lat]);
  let buffer = 100;
  let bbox = `${utmX - buffer},${utmY - buffer},${utmX + buffer},${utmY + buffer}`;
  let url = `https://geocloud.vd.dk/CVF/wms?\nSERVICE=WMS&\nVERSION=1.1.1&\nREQUEST=GetFeatureInfo&\nINFO_FORMAT=application/json&\nTRANSPARENT=true&\nLAYERS=CVF:veje&\nQUERY_LAYERS=CVF:veje&\nSRS=EPSG:25832&\nWIDTH=101&\nHEIGHT=101&\nBBOX=${bbox}&\nX=50&\nY=50`;
  try {
    let response = await fetch(url);
    let textData = await response.text();
    if (textData.startsWith("Results")) {
      let extractedData = parseTextResponse(textData);
      return extractedData;
    }
    let jsonData = JSON.parse(textData);
    if (jsonData.features && jsonData.features.length > 0) {
      return jsonData.features[0].properties;
    } else {
      return {};
    }
  } catch (error) {
    console.error("Fejl ved hentning af vejdata:", error);
    return {};
  }
}

function parseTextResponse(text) {
  let lines = text.split("\n");
  let data = {};
  lines.forEach(line => {
    let parts = line.split(" = ");
    if (parts.length === 2) {
      let key = parts[0].trim();
      let value = parts[1].trim();
      data[key] = value;
    }
  });
  return data;
}

/***************************************************
 * ➕ NY: getKmAtPoint – henter km via din Cloudflare-worker
 * Returnerer "" hvis intet kan udledes.
 ***************************************************/
async function getKmAtPoint(lat, lon) {
  try {
    const [x, y] = proj4("EPSG:4326", "EPSG:25832", [lon, lat]);
    const stats = await checkForStatsvej(lat, lon);
    const roadNumber = stats.ADM_NR ?? stats.adm_nr ?? null;
    const roadPart   = stats.FORGRENING ?? stats.forgrening ?? 0;
    if (!roadNumber) return "";
    const url =
      `${VD_PROXY}/reference` +
      `?geometry=POINT(${x}%20${y})` +
      `&srs=EPSG:25832` +
      `&roadNumber=${roadNumber}` +
      `&roadPart=${roadPart}` +
      `&format=json`;
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      return "";
    }
    const data = await resp.json();
    const props =
      data?.properties ??
      data?.feature?.properties ??
      data?.features?.[0]?.properties ??
      data;
    const from = props?.from ?? props?.FROM ?? props?.fra ?? props?.at ?? null;
    const to   = props?.to   ?? props?.TO   ?? props?.til ?? null;
    const kmtText =
      from?.kmtText ?? from?.KMTTEXT ??
      to?.kmtText   ?? to?.KMTTEXT   ??
      props?.kmtText ?? props?.KMTEKST ?? props?.kmtekst ??
      props?.KM_TEXT ?? props?.km_text ?? props?.kmtegn ??
      null;
    if (kmtText) return String(kmtText);
    const km = (from?.km ?? props?.km ?? props?.KM ?? null);
    const m  = (from?.m  ?? props?.m  ?? props?.M  ?? props?.km_meter ?? null);
    if (km != null && m != null) {
      return `${km}/${String(m).padStart(4, "0")}`;
    }
    return "";
  } catch (e) {
    console.error("getKmAtPoint fejl:", e);
    return "";
  }
}

/***************************************************
 * Statsvej / info-bokse
 ***************************************************/
const statsvejInfoBox = document.getElementById("statsvejInfoBox");
const statsvejCloseBtn = document.getElementById("statsvejCloseBtn");
statsvejCloseBtn.addEventListener("click", function() {
  statsvejInfoBox.style.display = "none";
  document.getElementById("infoBox").style.display = "none";
  resetCoordinateBox();
  if (currentMarker) {
    map.removeLayer(currentMarker);
    currentMarker = null;
  }
});
const infoCloseBtn = document.getElementById("infoCloseBtn");
infoCloseBtn.addEventListener("click", function() {
  document.getElementById("infoBox").style.display = "none";
  document.getElementById("statsvejInfoBox").style.display = "none";
  if (currentMarker) {
    map.removeLayer(currentMarker);
    currentMarker = null;
  }
  resetCoordinateBox();
  resultsList.innerHTML = "";
  document.getElementById("kommuneOverlay").style.display = "none";
});

/***************************************************
 * "Find X"-knap => find intersection med Turf.js
 ***************************************************/
document.getElementById("findKrydsBtn").addEventListener("click", async function() {
  if (!selectedRoad1 || !selectedRoad2) {
    alert("Vælg venligst to veje først.");
    return;
  }
  if (!selectedRoad1.geometry || !selectedRoad2.geometry) {
    alert("Geometri ikke tilgængelig for en eller begge veje.");
    return;
  }
  let line1 = turf.multiLineString(selectedRoad1.geometry.coordinates);
  let line2 = turf.multiLineString(selectedRoad2.geometry.coordinates);
  let intersection = turf.lineIntersect(line1, line2);
  if (intersection.features.length === 0) {
    alert("De valgte veje krydser ikke hinanden.");
  } else {
    let latLngs = [];
    for (let i = 0; i < intersection.features.length; i++) {
      let feat = intersection.features[i];
      let coords = feat.geometry.coordinates;
      let [wgsLon, wgsLat] = proj4("EPSG:25832", "EPSG:4326", [coords[0], coords[1]]);
      latLngs.push([wgsLat, wgsLon]);
      let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${wgsLon}&y=${wgsLat}&struktur=flad`;
      let marker = L.marker([wgsLat, wgsLon]).addTo(map);
      try {
        let resp = await fetch(revUrl);
        let revData = await resp.json();
        let addressStr = `${revData.vejnavn || "Ukendt"} ${revData.husnr || ""}, ${revData.postnr || "?"} ${revData.postnrnavn || ""}`;
        let evaFormat = `${revData.vejnavn || ""},${revData.husnr || ""},${revData.postnr || ""}`;
        let notesFormat = `${revData.vejnavn || ""} ${revData.husnr || ""}, ${revData.postnr || ""} ${revData.postnrnavn || ""}`;
        marker.bindPopup(`
          ${addressStr}<br>
          <a href="#" title="Kopier til Eva.net" onclick="(function(el){ el.style.color='red'; copyToClipboard('${evaFormat}'); showCopyPopup('Kopieret'); setTimeout(function(){ el.style.color=''; },1000); })(this); return false;">Eva.Net</a>
          &nbsp;
          <a href="#" title="Kopier til Notes" onclick="(function(el){ el.style.color='red'; copyToClipboard('${notesFormat}'); showCopyPopup('Kopieret'); setTimeout(function(){ el.style.color=''; },1000); })(this); return false;">Notes</a>
        `).openPopup();
      } catch (err) {
        console.error("Reverse geocoding fejl ved vejkryds:", err);
        marker.bindPopup(`(${wgsLat.toFixed(6)}, ${wgsLon.toFixed(6)})<br>Reverse geocoding fejlede.`).openPopup();
      }
      setCoordinateBox(wgsLat, wgsLon);
      marker.on("popupclose", function() {
        map.removeLayer(marker);
      });
    }
    if (latLngs.length === 1) {
      map.setView(latLngs[0], 16);
    } else {
      map.fitBounds(latLngs);
    }
  }
});

/***************************************************
 * NYT: Distance Options – Tegn cirkel med radius 10, 25, 50 eller 100 km
 ***************************************************/
var currentCircle = null;
var selectedRadius = null;
function toggleCircle(radius) {
  selectedRadius = radius;
  if (!currentMarker) {
    alert("Vælg venligst en adresse eller klik på kortet først.");
    return;
  }
  let latLng = currentMarker.getLatLng();
  if (currentCircle && currentCircle.getRadius() === radius) {
    map.removeLayer(currentCircle);
    currentCircle = null;
    selectedRadius = null;
    if (map.hasLayer(chargeMapLayer)) {
      map.removeLayer(chargeMapLayer);
    }
  } else {
    if (currentCircle) {
      map.removeLayer(currentCircle);
    }
    currentCircle = L.circle(latLng, {
      radius: radius,
      color: "blue",
      fillOpacity: 0.2
    }).addTo(map);
    if (map.hasLayer(chargeMapLayer)) {
      map.fire('overlayadd', { layer: chargeMapLayer });
    }
  }
}
document.getElementById("btn10").addEventListener("click", function() {
  selectedRadius = 10000;
  toggleCircle(10000);
});
document.getElementById("btn25").addEventListener("click", function() {
  selectedRadius = 25000;
  toggleCircle(25000);
});
document.getElementById("btn50").addEventListener("click", function() {
  selectedRadius = 50000;
  toggleCircle(50000);
});
document.getElementById("btn100").addEventListener("click", function() {
  selectedRadius = 100000;
  toggleCircle(100000);
});
document.addEventListener("DOMContentLoaded", function() {
  document.getElementById("search").focus();

  // Tilføj klik‑håndtering til ORS‑ruteplanlægningsknappen, hvis den findes i DOM
  const planBtn = document.getElementById("planRouteBtn");
  if (planBtn) {
    planBtn.addEventListener("click", function() {
      planRouteORS();
    });
  }
});
