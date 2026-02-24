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
 * 2.000 ruteopslag pr. dag og 40 pr. minut. Før du kan
 * anvende tjenesten skal du oprette en gratis konto og hente en API-nøgle.
 * Besøg https://openrouteservice.org/, opret en konto og generér en nøgle
 * under sektionen "API Keys" i din brugerprofil. Indsæt nøglen i
 * konstanten ORS_API_KEY nedenfor.
 */

// TODO: Indsæt din ORS API-nøgle her
const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImU2ZTA5ODhhNDE5MDQ1MjNiY2QwM2QyZjcyNWViZmU5IiwiaCI6Im11cm11cjY0In0=";

// Lag til at vise ruter fra ORS. Tilføjes til overlayMaps senere.
var routeLayer = L.layerGroup();

/**
 * Udtræk et repræsentativt punkt fra en vejgeometri
 * (beholdt som hjælper hvis du senere vil lave ruter ud fra vej-geometrier)
 */
function getRepresentativeCoordinate(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  let coords = geometry.coordinates;
  let firstLine = Array.isArray(coords[0]) ? coords[0] : null;
  if (!firstLine || firstLine.length === 0) return null;
  let firstCoord = firstLine[0];
  if (!firstCoord || firstCoord.length < 2) return null;
  let x = firstCoord[0];
  let y = firstCoord[1];
  if (Math.abs(x) > 90 || Math.abs(y) > 90) {
    let [lat, lon] = convertToWGS84(x, y);
    return [lat, lon];
  }
  return [firstCoord[1], firstCoord[0]];
}

/**
 * Hjælper: opdater "Start"-knappen med ORS-remaining
 */
function updateORSQuotaIndicator(remaining, limit) {
  const btn = document.getElementById("planRouteBtn");
  if (!btn) return;

  // Gem original tekst første gang
  if (!btn.dataset.baseText) {
    btn.dataset.baseText = btn.textContent.trim() || "Start";
  }
  const baseText = btn.dataset.baseText;

  if (remaining == null) {
    // Hvis vi ikke kan læse headeren, rør ikke ved teksten
    return;
  }

  const rem = parseInt(remaining, 10);
  if (isNaN(rem)) return;

  // Opdater knaptekst og tooltip
  btn.textContent = `${baseText} (${rem})`;
  if (limit != null) {
    const lim = parseInt(limit, 10);
    if (!isNaN(lim)) {
      btn.title = `ORS Directions: ${rem}/${lim} kald tilbage i denne periode`;
    } else {
      btn.title = `ORS Directions: ${rem} kald tilbage i denne periode`;
    }
  } else {
    btn.title = `ORS Directions: ${rem} kald tilbage i denne periode`;
  }
}
/**
 * Hjælper: opdater Udland/Geocode-tæller ved søgefeltet
 * Bruges af ORS Geocode Search / Reverse.
 */
function updateORSGeocodeQuotaIndicator(remaining, limit, reset) {
  const span = document.getElementById("orsGeocodeQuota");
  if (!span) return;

  // Vis kun tælleren, når Udland-checkboxen er slået til
  if (typeof foreignSearchToggle !== "undefined" && foreignSearchToggle && !foreignSearchToggle.checked) {
    span.style.display = "none";
    return;
  }

  if (remaining == null) {
    // Hvis vi ikke kan læse headeren, ryd teksten
    span.textContent = "";
    span.title = "";
    return;
  }

  const rem = parseInt(remaining, 10);
  const lim = limit != null ? parseInt(limit, 10) : null;
  if (isNaN(rem)) return;

  // Sørg for at tælleren er synlig, når vi har gyldige data
  span.style.display = "inline";

  // Kun tal – ingen "Geo"
  if (!isNaN(lim) && lim > 0) {
    span.textContent = `${rem}/${lim}`;
  } else {
    span.textContent = `${rem}`;
  }

  let tooltip = "OpenRouteService geocoding – resterende kald i denne periode";
  if (!isNaN(lim) && lim > 0) {
    tooltip += `: ${rem}/${lim}`;
  } else {
    tooltip += `: ${rem}`;
  }

  // Forsøg at udlede hvornår kvoten fornyes ud fra x-ratelimit-reset (hvis eksisterer)
  if (reset != null) {
    const resetNum = parseInt(reset, 10);
    if (!isNaN(resetNum) && resetNum > 0) {
      let resetDate;
      if (resetNum > 1e12) {
        // Millisekund Unix-timestamp
        resetDate = new Date(resetNum);
      } else if (resetNum > 1e9) {
        // Sekund Unix-timestamp
        resetDate = new Date(resetNum * 1000);
      } else {
        // Antal sekunder fra nu
        resetDate = new Date(Date.now() + resetNum * 1000);
      }
      const hh = String(resetDate.getHours()).padStart(2, "0");
      const mm = String(resetDate.getMinutes()).padStart(2, "0");
      tooltip += ` (fornyes ca. kl. ${hh}:${mm})`;
    }
  }

  span.title = tooltip;
}

/**
 * Hjælper: opdater Udland-tæller (geocode) ved søgefeltet
 * Bruger ORS' egne rate-limit headers, når de er tilgængelige.
 */
function updateORSGeocodeIndicator(remaining, limit, reset) {
  const el = document.getElementById("orsGeocodeQuota");
  if (!el) return;

  if (remaining == null) {
    el.textContent = "";
    el.title = "";
    return;
  }

  const rem = parseInt(remaining, 10);
  const lim = limit != null ? parseInt(limit, 10) : null;

  if (isNaN(rem)) {
    el.textContent = "";
    el.title = "";
    return;
  }

  if (!isNaN(lim)) {
    el.textContent = `${rem}/${lim}`;
    el.title = `ORS Geocode: ${rem}/${lim} kald tilbage i denne periode`;
  } else {
    el.textContent = `${rem}`;
    el.title = `ORS Geocode: ${rem} kald tilbage i denne periode`;
  }

  // Valgfrit: vis hvornår kvoten nulstilles, hvis ORS sender en reset-header
  if (reset != null && reset !== "") {
    const resetNum = parseInt(reset, 10);
    if (!isNaN(resetNum)) {
      const resetDate = new Date(resetNum * 1000);
      el.title += `\nNulstilles ca.: ${resetDate.toLocaleString()}`;
    }
  }
}

/**
 * Hjælper: kald ORS Directions API som GeoJSON
 * coordinates: array af [lon, lat]
 * profile: fx "driving-car", "cycling-regular"
 * preference: fx "fastest", "shortest", "recommended"
 * Returnerer { coords: [ [lon,lat], ... ], distance, duration }
 */
async function requestORSRoute(coordsArray, profile, preference) {
  const usedProfile =
    profile ||
    (document.getElementById("routeProfile")?.value || "driving-car");

  const url = `https://api.openrouteservice.org/v2/directions/${usedProfile}/geojson`;

  const bodyObj = { coordinates: coordsArray };
  if (preference) {
    bodyObj.preference = preference;
  } else {
    const prefSel = document.getElementById("routePreference");
    if (prefSel && prefSel.value) {
      bodyObj.preference = prefSel.value;
    }
  }

  const headers = {
    "Accept": "application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8",
    "Authorization": ORS_API_KEY,
    "Content-Type": "application/json; charset=utf-8"
  };

  const body = JSON.stringify(bodyObj);

  const resp = await fetch(url, {
    method: "POST",
    headers: headers,
    body: body
  });

  // Forsøg at læse rate-limit headers til tæller på "Start"
  try {
    const remaining = resp.headers.get("x-ratelimit-remaining");
    const limit = resp.headers.get("x-ratelimit-limit");
    if (remaining != null) {
      updateORSQuotaIndicator(remaining, limit);
    }
  } catch (e) {
    console.warn("Kunne ikke læse ORS rate-limit headers:", e);
  }

  if (!resp.ok) {
    throw new Error(`ORS-fejl: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  if (!data.features || data.features.length === 0) {
    throw new Error("ORS returnerede ingen rute.");
  }

  const feature = data.features[0];
  const geom = feature.geometry;
  if (!geom || !Array.isArray(geom.coordinates)) {
    throw new Error("ORS returnerede ukendt geometri.");
  }

  const props = feature.properties || {};
  let distance = 0;
  let duration = 0;

  if (Array.isArray(props.segments) && props.segments.length > 0) {
    props.segments.forEach(seg => {
      if (typeof seg.distance === "number") distance += seg.distance;
      if (typeof seg.duration === "number") duration += seg.duration;
    });
  } else if (props.summary) {
    if (typeof props.summary.distance === "number") distance = props.summary.distance;
    if (typeof props.summary.duration === "number") duration = props.summary.duration;
  }

  return {
    coords: geom.coordinates, // [lon,lat]
    distance: distance,
    duration: duration
  };
}

/**
 * Hjælper: ORS geocoding (første resultat) til rute-felter
 */
async function geocodeORSFirst(text) {
  if (!ORS_API_KEY || ORS_API_KEY.includes("YOUR_ORS_API_KEY")) return null;
  try {
    const url = `https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${encodeURIComponent(text)}&size=1`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error("ORS geocode fejl:", resp.status, resp.statusText);
      return null;
    }

    try {
      const remaining = resp.headers.get("x-ratelimit-remaining");
      const limit = resp.headers.get("x-ratelimit-limit");
      const reset = resp.headers.get("x-ratelimit-reset");
      if (remaining != null) {
        updateORSGeocodeIndicator(remaining, limit, reset);
      }
    } catch (e) {
      console.warn("Kunne ikke læse ORS geocode rate-limit headers (geocodeORSFirst):", e);
    }

    const data = await resp.json();
    if (!data.features || data.features.length === 0) return null;
    const feat = data.features[0];
    const coords = feat.geometry && feat.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    const lon = coords[0];
    const lat = coords[1];
    return [lat, lon];
  } catch (err) {
    console.error("Fejl i geocodeORSFirst:", err);
    return null;
  }
}

/**
 * Hjælper: ORS geocoding til søgelisten (kun udenlandske adresser)
 */
/**
 * Hjælper: ORS geocoding til søgelisten (kun udenlandske adresser)
 */
async function geocodeORSForSearch(query) {
  if (!ORS_API_KEY || ORS_API_KEY.includes("YOUR_ORS_API_KEY")) return [];
  try {
    const url = `https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${encodeURIComponent(query)}&size=5`;
    const resp = await fetch(url);

    // Opdater geocode-tæller ud fra headers (hvis de findes)
    try {
      const remaining = resp.headers.get("x-ratelimit-remaining");
      const limit = resp.headers.get("x-ratelimit-limit");
      const reset = resp.headers.get("x-ratelimit-reset");
      if (remaining != null) {
        updateORSGeocodeQuotaIndicator(remaining, limit, reset);
      }
    } catch (e) {
      console.warn("Kunne ikke læse ORS geocode rate-limit headers (search):", e);
    }

    if (!resp.ok) {
      console.error("ORS geocode (search) fejl:", resp.status, resp.statusText);
      return [];
    }
    const data = await resp.json();
    if (!data.features || data.features.length === 0) return [];

    return data.features
      .filter(feat => {
        const p = feat.properties || {};
        const country = (p.country || p.country_a || "").toString().toLowerCase();
        return country && !["danmark", "denmark", "dk", "dnk"].includes(country);
      })
      .map(feat => {
        const p = feat.properties || {};
        const coords = feat.geometry && feat.geometry.coordinates;
        const lon = coords?.[0];
        const lat = coords?.[1];
        let label =
          p.label ||
          `${p.street || p.name || ""} ${p.housenumber || ""}, ${p.postalcode || ""} ${p.locality || p.region || p.country || ""}`
            .replace(/\s+/g, " ")
            .trim();
        return {
          type: "ors_foreign",
          label,
          lat,
          lon,
          feature: feat
        };
      });
  } catch (err) {
    console.error("Fejl i geocodeORSForSearch:", err);
    return [];
  }
}

/**
 * Hjælper: ORS reverse geocoding (til klik i udlandet)
 */
/**
 * Hjælper: ORS reverse geocoding (til klik i udlandet)
 */
async function reverseGeocodeORS(lat, lon) {
  if (!ORS_API_KEY || ORS_API_KEY.includes("YOUR_ORS_API_KEY")) return null;
  try {
    const url = `https://api.openrouteservice.org/geocode/reverse?api_key=${ORS_API_KEY}&point.lat=${lat}&point.lon=${lon}&size=1`;
    const resp = await fetch(url);

    // Opdater geocode-tæller ud fra headers (hvis de findes)
    try {
      const remaining = resp.headers.get("x-ratelimit-remaining");
      const limit = resp.headers.get("x-ratelimit-limit");
      const reset = resp.headers.get("x-ratelimit-reset");
      if (remaining != null) {
        updateORSGeocodeQuotaIndicator(remaining, limit, reset);
      }
    } catch (e) {
      console.warn("Kunne ikke læse ORS geocode rate-limit headers (reverse):", e);
    }

    if (!resp.ok) {
      console.error("ORS reverse geocode fejl:", resp.status, resp.statusText);
      return null;
    }
    const data = await resp.json();
    if (!data.features || data.features.length === 0) return null;
    return data.features[0];
  } catch (err) {
    console.error("Fejl i reverseGeocodeORS:", err);
    return null;
  }
}

/**
 * Hjælper: er koordinat i DK (ca. bounding box)
 */
function isInDenmark(lat, lon) {
  return lat >= 54.3 && lat <= 58.0 && lon >= 7.5 && lon <= 15.5;
}
function isInDenmarkByPolygon(lat, lon) {
  if (!kommuneGeoJSON || !kommuneGeoJSON.features) {
    // Fallback til simpel bounding box, hvis kommunedata ikke er klar endnu
    return isInDenmark(lat, lon);
  }
  try {
    var point = turf.point([lon, lat]);
    for (var i = 0; i < kommuneGeoJSON.features.length; i++) {
      var feat = kommuneGeoJSON.features[i];
      if (turf.booleanPointInPolygon(point, feat)) {
        return true;
      }
    }
    return false;
  } catch (e) {
    console.error("Fejl i isInDenmarkByPolygon:", e);
    return isInDenmark(lat, lon);
  }
}

/**
 * Hjælper: find koordinater (lat,lon) for en adresse-tekst
 * Bruger evt. allerede gemte koordinater, ellers Dataforsyningen
 * og falder tilbage til ORS geocoding for udenlandske adresser.
 */
async function resolveRouteCoord(text, cachedCoord) {
  if (cachedCoord && Array.isArray(cachedCoord) && cachedCoord.length === 2) {
    return cachedCoord;
  }
  if (!text || text.trim().length === 0) return null;

  try {
    const url = `https://api.dataforsyningen.dk/adgangsadresser/autocomplete?q=${encodeURIComponent(text)}&per_side=1`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (!Array.isArray(data) || data.length === 0 || !data[0].adgangsadresse?.id) {
      // Fald tilbage til ORS, hvis DF ikke finder noget
      const orsCoord = await geocodeORSFirst(text);
      if (orsCoord) return orsCoord;
      return null;
    }

    const id = data[0].adgangsadresse.id;
    const detailResp = await fetch(`https://api.dataforsyningen.dk/adgangsadresser/${id}`);
    const detail = await detailResp.json();
    const coords = detail.adgangspunkt?.koordinater;
    if (!coords || coords.length < 2) return null;
    const lon = coords[0];
    const lat = coords[1];
    return [lat, lon];
  } catch (err) {
    console.error("Fejl i resolveRouteCoord:", err);
    // Sidste fallback: ORS
    const orsCoord = await geocodeORSFirst(text);
    if (orsCoord) return orsCoord;
    return null;
  }
}

/**
 * Planlæg rute ud fra rute-felterne (Fra / Til / Via)
 * Bruger OpenRouteService og tegner ruten på routeLayer.
 */
async function planRouteORS() {
  if (!ORS_API_KEY || ORS_API_KEY.includes("YOUR_ORS_API_KEY")) {
    alert("ORS API-nøgle mangler. Indsæt din nøgle i konstanten ORS_API_KEY i script.js.");
    return;
  }

  try {
    const fromText = routeFromInput ? routeFromInput.value.trim() : "";
    const toText   = routeToInput   ? routeToInput.value.trim()   : "";
    const viaText  = routeViaInput  ? routeViaInput.value.trim()  : "";

    if (!fromText || !toText) {
      alert("Angiv både 'Fra' og 'Til' adresse.");
      return;
    }

    const fromCoord = await resolveRouteCoord(fromText, routeFromCoord);
    const toCoord   = await resolveRouteCoord(toText, routeToCoord);
    let viaCoord    = null;
    if (viaText) {
      viaCoord = await resolveRouteCoord(viaText, routeViaCoord);
    }

    if (!fromCoord || !toCoord) {
      alert("Kunne ikke finde koordinater for en eller flere adresser.");
      return;
    }

    // Koordinater i ORS-format [lon, lat]
    const coordsArray = [];
    coordsArray.push([fromCoord[1], fromCoord[0]]);
    if (viaCoord) coordsArray.push([viaCoord[1], viaCoord[0]]);
    coordsArray.push([toCoord[1], toCoord[0]]);

    // Profil + præference fra dropdowns
    const profileSel = document.getElementById("routeProfile");
    const prefSel    = document.getElementById("routePreference");
    const profile    = profileSel ? profileSel.value : "driving-car";
    const preference = prefSel ? prefSel.value : "recommended";

    const routeInfo = await requestORSRoute(coordsArray, profile, preference);

    // Tegn ruten
    routeLayer.clearLayers();
    const latLngs = routeInfo.coords.map(c => [c[1], c[0]]);
    const poly = L.polyline(latLngs, {
      color: "blue",
      weight: 5,
      opacity: 0.7
    }).addTo(routeLayer);

    if (!map.hasLayer(routeLayer)) {
      routeLayer.addTo(map);
    }
    map.fitBounds(poly.getBounds());

    const routeSummaryEl = document.getElementById("routeSummary");
    if (routeSummaryEl) {
      let parts = [];
      if (routeInfo.distance != null) {
        const km = routeInfo.distance / 1000;
        parts.push(`Længde: ${km.toFixed(1)} km`);
      }
      if (routeInfo.duration != null) {
        const min = Math.round(routeInfo.duration / 60);
        parts.push(`Tid: ca. ${min} min`);
      }
      routeSummaryEl.textContent = parts.join(" | ");
    }
  } catch (err) {
    console.error("ORS ruteplanlægningsfejl:", err);
    alert("Der opstod en fejl ved beregning af ruten. Se konsollen (F12) for detaljer.");
  }
}

function convertToWGS84(x, y) {
  let result = proj4("EPSG:25832", "EPSG:4326", [x, y]);
  console.log("convertToWGS84 output:", result);
  return [result[1], result[0]];
}
/***************************************************
 * Custom Places
 ***************************************************/
var customPlaces = [];

// Hent custom places fra ekstern fil "CustomPlaces"
// Første objekt i filen kan bruges som skabelon
// og markeres med "template": true – det bliver filtreret fra.
fetch("CustomPlaces")
  .then(function(response) {
    return response.json();
  })
  .then(function(data) {
    if (!Array.isArray(data)) {
      console.error("CustomPlaces indeholder ikke et array:", data);
      return;
    }
    customPlaces = data
      .filter(function(p) {
        return !p.template && !p.isTemplate;
      })
      .map(function(p) {
        // Sørg for at coords stadig findes, så eksisterende logik virker
        if (typeof p.lat === "number" && typeof p.lon === "number") {
          p.coords = [p.lat, p.lon];
        }
        return p;
      });
    console.log("Custom places indlæst:", customPlaces);
  })
  .catch(function(err) {
    console.error("Fejl ved hentning af CustomPlaces:", err);
  });
/***************************************************
 * Statsveje (punkter med motorvejs-/statsvejsdata)
 ***************************************************/
var statsveje = [];

// Hent statsveje fra ekstern fil "Statsveje"
// Strukturen forventes ca. som:
// [
//   {
//     "navn": "MTV M11 V AFK 18 HOLBÆK Ø",
//     "lat": 55.676830,
//     "lon": 11.740791,
//     "adresse": "Toftebanke 18, 4390 Vipperød",
//     "retning": "V",
//     "ruteNr": "21",
//     "type": "Motorvej",
//     "supplAdresse": "1: 112 - 2: 128 - 3: 110",
//     "vejkategori": "B",
//     "antalSpor": "1",
//     "forgrening": "3",
//     "noedspor": "NEJ",
//     "responsHverdage": "40 min",
//     "responsOevrig": "40 min",
//     "kmPael": "59",
//     "admNummer": "11"
//   },
//   ...
// ]
fetch("Statsveje")
  .then(function(response) {
    return response.json();
  })
  .then(function(data) {
    if (!Array.isArray(data)) {
      console.error("Statsveje indeholder ikke et array:", data);
      return;
    }
    statsveje = data
      .filter(function(p) {
        return !p.template && !p.isTemplate;
      })
      .map(function(p) {
        if (typeof p.lat === "number" && typeof p.lon === "number") {
          p.coords = [p.lat, p.lon];
        }
        return p;
      });
    console.log("Statsveje indlæst:", statsveje);
  })
  .catch(function(err) {
    console.error("Fejl ved hentning af Statsveje:", err);
  });

/***************************************************
 * Statsveje – hjælpere til søgning og visning
 ***************************************************/
function findNearbyStatsveje(lat, lon) {
  if (!statsveje || statsveje.length === 0) {
    return [];
  }
  if (typeof map === "undefined") {
    return [];
  }

  var clickLatLng = L.latLng(lat, lon);
  var steps = [50, 100, 200, 500]; // meter

  var withDistances = statsveje
    .map(function(p) {
      var pLat;
      var pLon;
      if (typeof p.lat === "number" && typeof p.lon === "number") {
        pLat = p.lat;
        pLon = p.lon;
      } else if (Array.isArray(p.coords) && p.coords.length === 2) {
        pLat = p.coords[0];
        pLon = p.coords[1];
      } else {
        return null;
      }
      var dist = map.distance(clickLatLng, L.latLng(pLat, pLon));
      return {
        place: p,
        dist: dist
      };
    })
    .filter(function(entry) {
      return entry !== null;
    })
    .sort(function(a, b) {
      return a.dist - b.dist;
    });

  if (withDistances.length === 0) {
    return [];
  }

  // Gå gennem radius-trin, og returnér de(t) nærmeste for første trin med resultater
  for (var i = 0; i < steps.length; i++) {
    var r = steps[i];
    var within = withDistances.filter(function(entry) {
      return entry.dist <= r;
    });
    if (within.length > 0) {
      var bestDist = within[0].dist;
      var best = within.filter(function(entry) {
        return Math.abs(entry.dist - bestDist) <= 5;
      });
      return best;
    }
  }

  return [];
}

function renderStatsvejFromStatsvejsObj(statsObj) {
  var statsvejInfoEl = document.getElementById("statsvejInfo");
  var statsvejBox = document.getElementById("statsvejInfoBox");
  if (!statsvejInfoEl || !statsvejBox || !statsObj) return;

  var navn        = statsObj.navn        || "";
  var admNummer   = statsObj.admNummer   || statsObj.adm_nr || "";
  var forgrening  = statsObj.forgrening  || "";
  var ruteNr      = statsObj.ruteNr      || statsObj.rute_nr || "";
  var type        = statsObj.type        || statsObj.vejtype || "";
  var supplAdr    = statsObj.supplAdresse || statsObj.suppl_adresse || "";
  var vejkategori = statsObj.vejkategori || "";
  var antalSpor   = statsObj.antalSpor   || "";
  var noedspor    = statsObj.noedspor    || statsObj.nødspor || statsObj.nodspor || "";
  var respHverd   = statsObj.responsHverdage || statsObj.respons_hverdage || statsObj.hverdage || "";
  var respOevrig  = statsObj.responsOevrig   || statsObj.respons_oevrig   || statsObj.oevrigTid || statsObj.ovrig_tid || "";
  var kmPael      = statsObj.kmPael      || statsObj.km_pæl || statsObj.km || "";

  var html = "";

  if (navn) {
    html += "<strong>" + navn + "</strong><br>";
  }
  if (admNummer) {
    html += "<strong>Administrativt nummer:</strong> " + admNummer + "<br>";
  }
  if (forgrening) {
    html += "<strong>Forgrening:</strong> " + forgrening + "<br>";
  }
  if (ruteNr) {
    html += "<strong>Rute nr.:</strong> " + ruteNr + "<br>";
  }
  if (type) {
    html += "<strong>Vejtype:</strong> " + type + "<br>";
  }
  if (supplAdr) {
    html += "<strong>Suppl. adresse:</strong> " + supplAdr + "<br>";
  }
  if (vejkategori) {
    html += "<strong>Vejkategori:</strong> " + vejkategori + "<br>";
  }
  if (antalSpor) {
    html += "<strong>Antal spor:</strong> " + antalSpor + "<br>";
  }
  if (noedspor) {
    html += "<strong>Nødspor:</strong> " + noedspor + "<br>";
  }
  if (respHverd) {
    html += "<strong>Respons hverdage 6-18:</strong> " + respHverd + "<br>";
  }
  if (respOevrig) {
    html += "<strong>Respons øvrig tid:</strong> " + respOevrig + "<br>";
  }
  if (kmPael) {
    html += "<strong>Km:</strong> " + kmPael + "<br>";
  }

  statsvejInfoEl.innerHTML = html;
  statsvejBox.style.display = html ? "block" : "none";
}

function showStatsvejSelection(candidates) {
  var statsvejInfoEl = document.getElementById("statsvejInfo");
  var statsvejBox = document.getElementById("statsvejInfoBox");
  if (!statsvejInfoEl || !statsvejBox) return;

  statsvejInfoEl.innerHTML = "<strong>Flere statsveje fundet her – vælg sted:</strong><br>";

  var ul = document.createElement("ul");
  ul.style.paddingLeft = "20px";

  candidates.forEach(function(entry, index) {
    var p = entry.place;
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.href = "#";
    a.textContent = p.navn || ("Statsvej " + (index + 1));
    a.addEventListener("click", function(e) {
      e.preventDefault();
      renderStatsvejFromStatsvejsObj(p);
    });
    li.appendChild(a);
    ul.appendChild(li);
  });

  statsvejInfoEl.appendChild(ul);
  statsvejBox.style.display = "block";
}

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
    text = item.navn || "";
  } else if (item.type === "custom") {
    text = item.navn || "";
  } else if (item.type === "statsvej") {
    text = item.navn || "";
  } else if (item.type === "ors_foreign") {
    text = item.label || "";
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerText === lowerQuery) {
    return 0;
  } else if (lowerText.startsWith(lowerQuery)) {
    return 1;
  } else if (lowerText.includes(lowerQuery)) {
    return 2;
  } else {
    return 3;
  }
}

function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    const context = this;
    timeoutId = setTimeout(function() {
      fn.apply(context, args);
    }, delay);
  };
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

var osmLayer = L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors, © Styrelsen for Dataforsyning og Infrastruktur,© CVR API"
  }
).addTo(map);

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

/***************************************************
 * Vejrlag – OpenWeatherMap tiles
 * Kræver egen API-nøgle fra https://openweathermap.org/api
 ***************************************************/
const OWM_API_KEY = "71886b99dfc71fdd19c9825cf0b995c1"; // <-- indsæt din nøgle her som STRING

// Nedbør, temperatur og (valgfrit) kraftig regn
var weatherPrecipLayer = null;   // nedbør (som du har nu)
var weatherTempLayer   = null;   // temperatur
var weatherRainLayer   = null;   // mere "radar-agtig" regn (valgfri)

// Opret vejrlag hvis der faktisk står en nøgle
if (OWM_API_KEY && OWM_API_KEY.trim() !== "") {
  // Nedbør (modelbaseret nedbør / skyer)
  weatherPrecipLayer = L.tileLayer(
    `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`,
    {
      opacity: 0.7,
      attribution: "Vejrdata © OpenWeatherMap"
    }
  );

  // Temperatur – farvekort over temperatur i overfladen
  weatherTempLayer = L.tileLayer(
    `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`,
    {
      opacity: 0.7,
      attribution: "Vejrdata © OpenWeatherMap"
    }
  );

  // Kraftigere regn (valgfri) – kan kommenteres ud hvis du ikke vil have den
  weatherRainLayer = L.tileLayer(
    `https://tile.openweathermap.org/map/rain_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`,
    {
      opacity: 0.7,
      attribution: "Vejrdata © OpenWeatherMap"
    }
  );
}

var redningsnrLayer = L.tileLayer.wms("https://kort.strandnr.dk/geoserver/nobc/ows", {
  layers: "Redningsnummer",
  format: "image/png",
  transparent: true,
  version: "1.3.0",
  attribution: "Data: redningsnummer.dk"
});

var rutenummerLayer = L.tileLayer.wms("https://geocloud.vd.dk/VM/wms", {
  layers: "rutenummereret-vejnet",
  format: "image/png",
  transparent: true,
  version: "1.3.0",
  attribution: "© Vejdirektoratet"
});

/***************************************************
 * Falck Ass-lag
 ***************************************************/
var falckAssLayer = L.geoJSON(null, {
  onEachFeature: function(feature, layer) {
    let tekst = feature.properties.tekst || "Falck Ass";
    layer.bindPopup("<strong>" + tekst + "</strong>");
  },
  style: function() {
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
 * Kommunegrænser
 ***************************************************/
var kommunegrænserLayer = L.geoJSON(null, {
  style: function() {
    return {
      color: "#3388ff",
      weight: 2,
      fillOpacity: 0
    };
  }
});
var kommuneGeoJSON = null;

fetch("https://api.dataforsyningen.dk/kommuner?format=geojson")
  .then(response => response.json())
  .then(data => {
    kommunegrænserLayer.addData(data);
    kommuneGeoJSON = data;
    console.log("Kommunegrænser hentet:", data);
  })
  .catch(err => console.error("Fejl ved hentning af kommunegrænser:", err));

/***************************************************
 * Lagkontrol / overlays
 ***************************************************/
var dbSmsLayer     = L.layerGroup();
var dbJournalLayer = L.layerGroup();
var border25Layer  = L.layerGroup();
var chargeMapLayer = L.layerGroup();

// SharePoint-markører (vises kun når overlay aktiveres)
var sharePointMarkersLayer = L.layerGroup();
var sharePointMarkersLoaded = false; // så vi ikke loader igen og igen
// VIGTIGT: skal være deklareret før syncSharePointMode() kan referere til den
var spRefreshControl = null;
// NYT: SharePoint-tilstand (afledt af om overlayet faktisk er aktivt)
var sharePointModeEnabled = false;
// SharePoint Undo UI (DOM refs sættes senere når DOM er klar)
var spUndoBar = null;
var spUndoBtn = null;
var spUndoRange = null;
var spAreaSelect = null;
var spUndoStatus = null;

/**
 * Robust check: er SharePoint overlayet aktivt lige nu?
 * (Vi må ikke kun stole på overlayadd/overlayremove events)
 */
function isSharePointOverlayActive() {
  try {
    return !!(map && sharePointMarkersLayer && map.hasLayer(sharePointMarkersLayer));
  } catch (e) {
    return false;
  }
}

/**
 * Synk SharePoint-mode flag med overlayets faktiske status.
 * Bruges af UI-logik (fx om markør skal bevares ved clear).
 */
function syncSharePointMode() {
  sharePointModeEnabled = isSharePointOverlayActive();

  // Vis/skjul refresh-knap kun når SharePoint overlay er aktivt
  if (spRefreshControl && spRefreshControl._container) {
    spRefreshControl._container.style.display = sharePointModeEnabled ? "block" : "none";
  }

  // Vis/skjul Undo-bar kun når SharePoint overlay er aktivt
  if (spUndoBar) {
    spUndoBar.classList.toggle("hidden", !sharePointModeEnabled);
  }

  // Ryd status når vi slår SharePoint fra
  if (!sharePointModeEnabled && spUndoStatus) {
    spUndoStatus.textContent = "";
  }
}

/**
 * Hjælper: skal vi bevare currentMarker ved UI-ryd/close?
 * - true når "Behold markører" eller "SharePoint markører" er aktivt
 */
function shouldPreserveSelectionMarker() {
  return !!(keepMarkersEnabled || isSharePointOverlayActive());
}

/**
 * SharePoint marker-behavior:
 * - højreklik => slet markør (og slet i SharePoint hvis vi har itemId)
 * - klik => genåbn infoboks (hvis vi har gemte meta-data)
 */

// NYT: lag til at samle ekstra markører, når "Behold markører" er slået til
var keepMarkersLayer   = L.layerGroup();
var keepMarkersEnabled = false;

// Global reference til "seneste" markør (bruges bl.a. til radius)
var currentMarker;
// Aktiv markør som info-boksen (og note-feltet) aktuelt viser for
var activeInfoMarker = null;

/**
 * Vis/skjul og bind note-feltet til en given markør
 */
function setupMarkerNoteUI(marker) {
  const wrap = document.getElementById("markerNoteWrapper");
  const ta = document.getElementById("markerNote");
  if (!wrap || !ta) return;

  if (!marker) {
    wrap.style.display = "none";
    ta.value = "";
    ta.oninput = null;
    return;
  }

  wrap.style.display = "block";

  if (!marker._meta) marker._meta = {};
  ta.value = marker._meta.note || "";
  ta.oninput = function () {
    if (!marker._meta) marker._meta = {};
    marker._meta.note = ta.value;

    // Opdater hover-tooltip (adresse + note)
updateMarkerTooltip(marker);
    
    // Når SharePoint overlay er aktivt: gem note til SharePoint (debounced)
    if (isSharePointOverlayActive()) {
      queueSharePointNoteUpdate(marker, ta.value);
    }
  };
}

function setActiveInfoMarker(marker) {
  activeInfoMarker = marker || null;
  setupMarkerNoteUI(activeInfoMarker);
}

/**
 * HTML-escape (note/adresse kan komme fra brugeren)
 */
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Opdater marker-tooltip så den viser adresse + note (hvis note findes)
 */
function updateMarkerTooltip(marker) {
  if (!marker) return;
  if (!marker._meta) marker._meta = {};

  const addr = (marker._meta.addressText || "").trim();
  const note = (marker._meta.note || "").trim();

  // Hvis intet at vise -> fjern tooltip (hvis den findes)
  if (!addr && !note) {
    if (marker._meta._tooltipBound) {
      try { marker.unbindTooltip(); } catch (e) {}
      marker._meta._tooltipBound = false;
    }
    return;
  }

  // Build HTML (Leaflet tooltip accepterer HTML)
  let html = "";
  if (addr) html += `<strong>${escapeHtml(addr)}</strong>`;
  if (note) html += `${addr ? "<br>" : ""}${escapeHtml(note)}`;

  if (!marker._meta._tooltipBound) {
    marker.bindTooltip(html, { sticky: true, direction: "top" });
    marker._meta._tooltipBound = true;
  } else {
    try {
      marker.setTooltipContent(html);
    } catch (e) {
      try {
        marker.unbindTooltip();
        marker.bindTooltip(html, { sticky: true, direction: "top" });
        marker._meta._tooltipBound = true;
      } catch (e2) {}
    }
  }
}

/**
 * Sæt/Opdatér tooltip med adresse for hover
 */
function setMarkerHoverAddress(marker, addressText) {
  if (!marker) return;
  if (!marker._meta) marker._meta = {};
  marker._meta.addressText = addressText || "";

  // Tooltip bygges samlet (adresse + note)
  updateMarkerTooltip(marker);
 }
 
/**
 * Tilføj keep-markør-adfærd:
 * - højreklik (contextmenu) for at slette kun den ene markør (kun når keepMarkersEnabled)
 * - klik for at genåbne infoboks med gemte data (hvis muligt)
 */
function attachKeepMarkerBehaviors(marker) {
  if (!marker) return;
  if (marker._keepBehaviorsAttached) return;
  marker._keepBehaviorsAttached = true;

  marker.on("contextmenu", function () {
    if (!keepMarkersEnabled) return;

    const ok = confirm("Slet denne markør?");
    if (!ok) return;

    // Fjern kun denne markør
    if (keepMarkersLayer && keepMarkersLayer.hasLayer(marker)) {
      keepMarkersLayer.removeLayer(marker);
    } else if (map && map.hasLayer(marker)) {
      map.removeLayer(marker);
    }

    if (currentMarker === marker) currentMarker = null;

    if (activeInfoMarker === marker) {
      document.getElementById("infoBox").style.display = "none";
      document.getElementById("statsvejInfoBox").style.display = "none";
      document.getElementById("kommuneOverlay").style.display = "none";
      resetCoordinateBox();
      setActiveInfoMarker(null);
    }
  });

  marker.on("click", function () {
    // Klik på en "fastlåst" markør skal kunne vise infoboks igen
    const latlng = marker.getLatLng();
    if (marker._meta && marker._meta.dkReverseData) {
      updateInfoBox(marker._meta.dkReverseData, latlng.lat, latlng.lng);
      setActiveInfoMarker(marker);
    } else if (marker._meta && marker._meta.foreignFeature) {
      updateInfoBoxForeign(marker._meta.foreignFeature, latlng.lat, latlng.lng);
      setActiveInfoMarker(marker);
    } else {
      // Hvis vi ikke har gemt data, så gør vi kun note-feltet aktivt
      setActiveInfoMarker(marker);
    }
  });
}

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
  "DB SMS kort": dbSmsLayer,
  "DB Journal": dbJournalLayer,
  "25 km grænse": border25Layer,
  "Ladestandere": chargeMapLayer,
  "Rutenummereret vejnet": rutenummerLayer,
  "SharePoint markører": sharePointMarkersLayer,
  // NYT: overlay til at beholde markører
  "Behold markører": keepMarkersLayer
};
// Tilføj vejrlag, hvis API-nøgle er sat
if (weatherPrecipLayer) {
  overlayMaps["Nedbør (OWM)"] = weatherPrecipLayer;
}
if (weatherTempLayer) {
  overlayMaps["Temperatur (OWM)"] = weatherTempLayer;
}
if (weatherRainLayer) {
  overlayMaps["Regn (OWM)"] = weatherRainLayer;
}

L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(map);
// Init: synk SharePoint-mode med faktisk overlay-status

// ===============================
// SharePoint refresh helper + knap
// ===============================
async function refreshSharePointMarkersAsync() {
  // Kun refresh hvis overlayet er aktivt
  if (!map.hasLayer(sharePointMarkersLayer)) {
    alert("Tænd 'SharePoint markører' først, før du refresher.");
    return;
  }

  // Ryd + tillad reload
  sharePointMarkersLayer.clearLayers();
  sharePointMarkersLoaded = false;

  // Reload
  sharePointMarkersLoaded = true;
  await loadSharePointMarkers();
}

// Leaflet control-knap (Refresh)
const SharePointRefreshControl = L.Control.extend({
  options: { position: "topright" },
  onAdd: function () {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");

    // Start skjult (vises kun når "SharePoint markører" er aktivt)
    container.style.display = "none";

    // Gem reference, så vi kan toggle synlighed udefra
    this._container = container;

    const btn = L.DomUtil.create("a", "", container);
    btn.href = "#";
    btn.title = "Refresh SharePoint markører";
    btn.innerHTML = "⟳";
    btn.style.cursor = "pointer";

    // Undgå at kortet panorerer/zoomer når man klikker
    L.DomEvent.disableClickPropagation(container);

    btn.addEventListener("click", async (e) => {
      e.preventDefault();

      // Kun refresh hvis overlayet er aktivt
      if (!map.hasLayer(sharePointMarkersLayer)) {
        alert("Tænd 'SharePoint markører' først, før du refresher.");
        return;
      }

      // Loading state (synligt mens den henter)
      try {
        btn.innerHTML = "⟳…";
        btn.style.pointerEvents = "none";
        btn.style.opacity = "0.6";

        await refreshSharePointMarkersAsync();
      } finally {
        btn.innerHTML = "⟳";
        btn.style.pointerEvents = "";
        btn.style.opacity = "";
      }
    });

    return container;
  }
});

// Tilføj knappen til kortet
spRefreshControl = new SharePointRefreshControl();
map.addControl(spRefreshControl);
// Init: synk SharePoint-mode med faktisk overlay-status (nu hvor refresh-knappen findes)
syncSharePointMode();

map.on('overlayadd', async function(e) {
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

  } else if (e.layer === sharePointMarkersLayer) {
  // SharePoint-mode ON (robust sync)
  syncSharePointMode();

  // Load område-konfig + byg dropdown (kun når SP overlay er aktivt)
  await spLoadAreasConfig();
  spPopulateAreaSelect();

  // Når brugeren slår overlayet til, loader vi markører én gang
  if (!sharePointMarkersLoaded) {
    sharePointMarkersLoaded = true;
    loadSharePointMarkers();
  }

  } else if (e.layer === keepMarkersLayer) {
    // Når "Behold markører" slås til, går vi i multi-markør-tilstand
    keepMarkersEnabled = true;

    // Hvis der allerede findes en aktuel markør, flyttes den over i laget
    if (currentMarker) {
      if (map.hasLayer(currentMarker)) {
        map.removeLayer(currentMarker);
      }
      keepMarkersLayer.addLayer(currentMarker);

      // Sørg for højreklik-slet / klik-genåbn også på den markør
      attachKeepMarkerBehaviors(currentMarker);
    }
  }
});

// Når overlayet "Behold markører" slås FRA, rydder vi alle ekstra markører
map.on('overlayremove', function(e) {
  // Når SharePoint overlay slås fra: mode OFF + skjul refresh + ryd markører
  if (e.layer === sharePointMarkersLayer) {
        // SharePoint-mode OFF (robust sync)
    syncSharePointMode();
    sharePointMarkersLayer.clearLayers();
    sharePointMarkersLoaded = false;
    return;
  }

  if (e.layer === keepMarkersLayer) {
    keepMarkersEnabled = false;

    keepMarkersLayer.clearLayers();
    if (currentMarker && map.hasLayer(currentMarker)) {
      map.removeLayer(currentMarker);
      setActiveInfoMarker(null);
    }
    currentMarker = null;
  }
});

L.control.zoom({ position: 'bottomright' }).addTo(map);

/***************************************************
 * Kommune­data hentet fra "Kommuner.xlsx"
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
 * Nulstil / sæt koordinatboks
 ***************************************************/
function resetCoordinateBox() {
  const coordinateBox = document.getElementById("coordinateBox");
  coordinateBox.textContent = "";
  coordinateBox.style.display = "none";
}

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
 * Hjælper: opret/opdater "aktuel markør"
 * Respekterer keepMarkersEnabled / keepMarkersLayer
 ***************************************************/
function createSelectionMarker(lat, lon) {
  const spActive = isSharePointOverlayActive();

  // 1) SharePoint overlay aktivt: marker skal altid blive i sharePointMarkersLayer
  if (spActive) {
    const m = L.marker([lat, lon]);
    sharePointMarkersLayer.addLayer(m);
    currentMarker = m;

    attachSharePointMarkerBehaviors(currentMarker);
    setActiveInfoMarker(currentMarker);

    return currentMarker;
  }

  // 2) Normal / keep-mode (som før)
  if (!keepMarkersEnabled) {
    // Normal tilstand: kun én markør – fjern den gamle
    if (currentMarker && map && map.hasLayer(currentMarker)) {
      map.removeLayer(currentMarker);
    }
    currentMarker = L.marker([lat, lon]).addTo(map);
  } else {
    // Multi-markør-tilstand: behold alle markører i keepMarkersLayer
    const m = L.marker([lat, lon]);
    keepMarkersLayer.addLayer(m);
    currentMarker = m;

    attachKeepMarkerBehaviors(currentMarker);
  }

  setActiveInfoMarker(currentMarker);

  return currentMarker;
}

/***************************************************
 * Strandposter – global cache
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
  if (event.layer === redningsnrLayer) {
    console.log("Strandposter laget er tilføjet.");
    if (allStrandposter.length === 0) {
      console.log("Henter strandposter-data første gang...");
      fetchAllStrandposter();
    } else {
      console.log("Strandposter-data allerede hentet.");
    }
  }
});

/***************************************************
 * Klik på kort => reverse geocoding
 ***************************************************/
map.on('click', function(e) {
  let lat = e.latlng.lat;
  let lon = e.latlng.lng;

  // Brug fælles helper, så den respekterer "Behold markører"
  createSelectionMarker(lat, lon);

  setCoordinateBox(lat, lon);

  if (isInDenmarkByPolygon(lat, lon)) {
    // DK: Dataforsyningen
    let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${lon}&y=${lat}&struktur=flad`;
    fetch(revUrl)
      .then(r => r.json())
      .then(data => {
        updateInfoBox(data, lat, lon);
        fillRouteFieldsFromClick(data, lat, lon);
      })
      .catch(err => console.error("Reverse geocoding fejl:", err));
  } else {
    // Udland: ORS reverse geocoding
    reverseGeocodeORS(lat, lon)
      .then(feature => {
        if (!feature) return;

        updateInfoBoxForeign(feature, lat, lon);

        const p = feature.properties || {};
        const norm = {
          vejnavn: p.street || p.name || "",
          husnr: p.housenumber || "",
          postnr: p.postalcode || "",
          postnrnavn: p.locality || p.region || p.country || ""
        };
        fillRouteFieldsFromClick(norm, lat, lon);
      })
      .catch(err => console.error("ORS reverse geocoding fejl:", err));
  }
});

/***************************************************
 * updateInfoBox for danske adresser
 ***************************************************/
async function updateInfoBox(data, lat, lon) {
  const streetviewLink = document.getElementById("streetviewLink");
  const addressEl      = document.getElementById("address");
  const extraInfoEl    = document.getElementById("extra-info");
  const skråfotoLink   = document.getElementById("skraafotoLink");
  const overlay        = document.getElementById("kommuneOverlay");
  
  let adresseStr, vejkode, kommunekode;
  let evaFormat, notesFormat;
  
  if (data.adgangsadresse) {
    adresseStr = data.adgangsadresse.adressebetegnelse || 
                 `${data.adgangsadresse.vejnavn || ""} ${data.adgangsadresse.husnr || ""}, ${data.adgangsadresse.postnr || ""} ${data.adgangsadresse.postnrnavn || ""}`;
    evaFormat   = `${data.adgangsadresse.vejnavn || ""},${data.adgangsadresse.husnr || ""},${data.adgangsadresse.postnr || ""}`;
    notesFormat = `${data.adgangsadresse.vejnavn || ""} ${data.adgangsadresse.husnr || ""}, ${data.adgangsadresse.postnr || ""} ${data.adgangsadresse.postnrnavn || ""}`;
    vejkode     = data.adgangsadresse.vejkode || "?";
    kommunekode = data.adgangsadresse.kommunekode || "?";
  } else if (data.adressebetegnelse) {
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
  // Gem data på den aktuelle markør, så den kan vises igen senere (og hover kan vise adresse)
  if (currentMarker) {
    if (!currentMarker._meta) currentMarker._meta = {};
    currentMarker._meta.dkReverseData = data;     // gem reverse-data
    currentMarker._meta.foreignFeature = null;    // ryd evt. udlandsdata
        setMarkerHoverAddress(currentMarker, adresseStr);

    // Bind kun de relevante behaviors til den aktuelle mode
    if (sharePointModeEnabled) {
      attachSharePointMarkerBehaviors(currentMarker);
    } else if (keepMarkersEnabled) {
      attachKeepMarkerBehaviors(currentMarker);
    }

    setActiveInfoMarker(currentMarker);
  }

  extraInfoEl.innerHTML = "";
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

  // Statsvej-data – først forsøg via lokale "Statsveje", derefter fallback til VD
  const statsvejInfoEl = document.getElementById("statsvejInfo");
  let handledByLocalStatsvej = false;

  // Prøv at finde nærmeste statsvej-punkter fra lokal fil
  const nearbyStats = findNearbyStatsveje(lat, lon);

  if (nearbyStats && nearbyStats.length > 1) {
    // Flere kandidater tæt på – lad brugeren vælge
    showStatsvejSelection(nearbyStats);
    handledByLocalStatsvej = true;
  } else if (nearbyStats && nearbyStats.length === 1) {
    // Præcis ét lokalt punkt – vis det direkte
    renderStatsvejFromStatsvejsObj(nearbyStats[0].place);
    handledByLocalStatsvej = true;
  }

  if (!handledByLocalStatsvej) {
    // Ingen lokale statsveje fundet – brug VD som fallback
    let statsvejData = await checkForStatsvej(lat, lon);

    const admNr       = statsvejData?.ADM_NR       ?? statsvejData?.adm_nr       ?? null;
    const forgrening  = statsvejData?.FORGRENING   ?? statsvejData?.forgrening   ?? null;
    const betegnelse  = statsvejData?.BETEGNELSE   ?? statsvejData?.betegnelse   ?? null;
    const bestyrer    = statsvejData?.BESTYRER     ?? statsvejData?.bestyrer     ?? null;
    const vejtype     = statsvejData?.VEJTYPE      ?? statsvejData?.vejtype      ?? null;
    const beskrivelse = statsvejData?.BESKRIVELSE  ?? statsvejData?.beskrivelse  ?? null;
    const vejstatus   = statsvejData?.VEJSTATUS    ?? statsvejData?.vejstatus    ?? statsvejData?.VEJ_STATUS ?? statsvejData?.status ?? null;
    const vejmynd     = statsvejData?.VEJMYNDIGHED ?? statsvejData?.vejmyndighed ?? statsvejData?.VEJMYND     ?? statsvejData?.vejmynd ?? null;
  
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

      if (vejstatus) {
        html += `<br><strong>Vejstatus:</strong> ${vejstatus}`;
      }
      if (vejmynd) {
        html += `<br><strong>Vejmyndighed:</strong> ${vejmynd}`;
      }
      statsvejInfoEl.innerHTML = html;

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
  }

  document.getElementById("infoBox").style.display = "block";
  
  // Kommuneinfo
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
  
  const politikredsNavn = data.politikredsnavn
    ?? data.adgangsadresse?.politikredsnavn
    ?? null;
  const politikredsKode = data.politikredskode
    ?? data.adgangsadresse?.politikredskode
    ?? null;
  if (politikredsNavn || politikredsKode) {
    const polititekst = politikredsKode ? `${politikredsNavn || ""} (${politikredsKode})` : `${politikredsNavn}`;
    extraInfoEl.innerHTML += `<br><span style="font-size:16px;">Politikreds: ${polititekst}</span>`;
  }
}

/***************************************************
 * updateInfoBoxForeign – ORS-adresser i udlandet
 ***************************************************/
function updateInfoBoxForeign(feature, lat, lon) {
  const streetviewLink = document.getElementById("streetviewLink");
  const addressEl      = document.getElementById("address");
  const extraInfoEl    = document.getElementById("extra-info");
  const skråfotoLink   = document.getElementById("skraafotoLink");
  const overlay        = document.getElementById("kommuneOverlay");
  const statsvejInfoEl = document.getElementById("statsvejInfo");
  const statsvejBox    = document.getElementById("statsvejInfoBox");

  const p = feature.properties || {};
  const vejnavn = p.street || p.name || "";
  const husnr   = p.housenumber || "";
  const postnr  = p.postalcode || "";
  const by      = p.locality || p.region || p.country || "";

  const label =
    p.label ||
    `${vejnavn} ${husnr}, ${postnr} ${by}`.replace(/\s+/g, " ").trim();

  const evaFormat   = `${vejnavn},${husnr},${postnr}`;
  const notesFormat = `${vejnavn} ${husnr}, ${postnr} ${by}`;

  streetviewLink.href = `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lon}`;
  addressEl.textContent = label;
  // Gem udlands-feature på markøren + hover-tooltip + note-binding
  if (currentMarker) {
    if (!currentMarker._meta) currentMarker._meta = {};
    currentMarker._meta.foreignFeature = feature;
    currentMarker._meta.dkReverseData = null;
        setMarkerHoverAddress(currentMarker, label);

    if (sharePointModeEnabled) {
      attachSharePointMarkerBehaviors(currentMarker);
    } else if (keepMarkersEnabled) {
      attachKeepMarkerBehaviors(currentMarker);
    }

    setActiveInfoMarker(currentMarker);
  }

  extraInfoEl.innerHTML = `
    <a href="#" title="Kopier til Eva.net" onclick="(function(el){ el.style.color='red'; copyToClipboard('${evaFormat}'); showCopyPopup('Kopieret'); setTimeout(function(){ el.style.color=''; },1000); })(this); return false;">Eva.Net</a>
    &nbsp;
    <a href="#" title="Kopier til Notes" onclick="(function(el){ el.style.color='red'; copyToClipboard('${notesFormat}'); showCopyPopup('Kopieret'); setTimeout(function(){ el.style.color=''; },1000); })(this); return false;">Notes</a>
  `;

  // Ingen skråfoto / kommune / statsvej i udlandet
  skråfotoLink.style.display = "none";
  overlay.style.display = "none";
  statsvejInfoEl.innerHTML = "";
  statsvejBox.style.display = "none";

  document.getElementById("infoBox").style.display = "block";

  if (resultsList) resultsList.innerHTML = "";
  if (vej1List)    vej1List.innerHTML    = "";
  if (vej2List)    vej2List.innerHTML    = "";
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

// Checkbox til at styre udenlandsk søgning
var foreignSearchToggle =
  document.getElementById("enableForeignSearch") ||
  document.getElementById("foreignSearchToggle") ||
  document.getElementById("foreignSearch");

var orsGeocodeQuotaSpan = document.getElementById("orsGeocodeQuota");

// NYT: lille infoboks når "Udland" vælges
var foreignInfoBox   = document.getElementById("foreignInfoBox");
var foreignInfoClose = document.getElementById("foreignInfoClose");

// ===============================
// SharePoint Undo UI (hook + restore-flow)
// ===============================
spUndoBar = document.getElementById("spUndoBar");
spUndoBtn = document.getElementById("spUndoBtn");
spUndoRange = document.getElementById("spUndoRange");
spAreaSelect = document.getElementById("spAreaSelect");
spUndoStatus = document.getElementById("spUndoStatus");

if (spAreaSelect) {
  spAreaSelect.addEventListener("change", async function () {
    if (!isSharePointOverlayActive()) return;
    setSpUndoStatus("Indlæser område…", false);
    await refreshSharePointMarkersAsync();
    setSpUndoStatus("", false);
  });
}

// Load område-konfig ved opstart (så dropdown er klar)
loadSpAreasConfig();

// Område change => reload markører (kun hvis SP overlay er aktivt)
if (spAreaSelect) {
  spAreaSelect.addEventListener("change", async function () {
    spSelectedAreaKey = this.value || "all";
    localStorage.setItem("spSelectedAreaKey", spSelectedAreaKey);

    if (!isSharePointOverlayActive()) return;

    try {
      setSpUndoStatus("Opdaterer område…", false);
      await refreshSharePointMarkersAsync();
      setSpUndoStatus("", false);
    } catch (e) {
      console.warn("Område reload fejlede:", e);
      setSpUndoStatus("Fejl: kunne ikke opdatere område. Se konsollen (F12).", true);
    }
  });
}

function setSpUndoStatus(text, isError) {
  if (!spUndoStatus) return;
  spUndoStatus.textContent = text || "";
  spUndoStatus.style.color = isError ? "#b00020" : "#333";
}

async function restoreSharePointSoftDeleted(rangeKey) {
  // Worker endpoint (forventet): POST /markers/restore?workspace=...&mapId=...&range=hour|day
  const url =
    `/markers/restore` +
    `?workspace=${encodeURIComponent(SP_WORKSPACE)}` +
    `&mapId=${encodeURIComponent(SP_MAP_ID)}` +
    `&range=${encodeURIComponent(rangeKey || "last")}`;

  const resp = await spFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ range: rangeKey || "last" })
  });

  let data = null;
  try { data = await resp.json(); } catch (e) {}

  if (!resp.ok || (data && data.ok === false)) {
    console.error("Restore SharePoint markers failed:", data);
    throw new Error("Restore SharePoint markers failed");
  }

  return data || { ok: true };
}

if (spUndoBtn) {
  spUndoBtn.addEventListener("click", async function () {
    // Kun når overlayet er aktivt
    if (!isSharePointOverlayActive()) {
      setSpUndoStatus("Tænd 'SharePoint markører' først.", true);
      return;
    }

    const rangeKey = (spUndoRange && spUndoRange.value) ? spUndoRange.value : "last";

    try {
      spUndoBtn.disabled = true;
      setSpUndoStatus("Gendanner…", false);

            const restored = await restoreSharePointSoftDeleted(rangeKey);

      // Status-tekst (understøt forskellige return-formater fra worker)
      const restoredCount =
        restored.restoredCount ??
        restored.count ??
        restored.restored ??
        restored.updated ??
        null;

      // Hvis intet blev gendannet: vis besked og stop (ingen refresh, ingen "Fejl")
      if (restoredCount === 0) {
        setSpUndoStatus(
          restored.message || "Ingen markører at gendanne eller de er gendannet",
          false
        );
        // Sørg for at der ikke ligger gamle highlight-ids og driller
        spSetRestoredHighlightIds([]);
        return;
      }

      // Worker returnerer markerIds: gem dem så vi kan highlight'e efter reload
      const ids = restored.markerIds || (restored.markerId ? [restored.markerId] : []);
      spSetRestoredHighlightIds(ids);

      // Refresh SharePoint-laget (uden at røre "Behold markører")
      await refreshSharePointMarkersAsync();

      // Efter refresh: apply gul highlight på de gendannede markører
      spApplyHighlightsAfterReload();

      // Vis status
      if (typeof restoredCount === "number") {
        setSpUndoStatus(`Gendannet: ${restoredCount}`, false);
      } else {
        setSpUndoStatus("Gendan fuldført.", false);
      }
      
    } catch (e) {
      console.warn("Undo/restore fejlede:", e);
      setSpUndoStatus("Fejl: kunne ikke gendanne. Se konsollen (F12).", true);
    } finally {
      spUndoBtn.disabled = false;
    }
  });
}

// Initiel visning af quota-tekst og infoboks
if (orsGeocodeQuotaSpan) {
  orsGeocodeQuotaSpan.style.display =
    (foreignSearchToggle && foreignSearchToggle.checked) ? "inline" : "none";
}
if (foreignInfoBox) {
  foreignInfoBox.style.display =
    (foreignSearchToggle && foreignSearchToggle.checked) ? "block" : "none";
}

// Når man slår "Udland" til/fra
if (foreignSearchToggle) {
  foreignSearchToggle.addEventListener("change", function () {
    if (orsGeocodeQuotaSpan) {
      orsGeocodeQuotaSpan.style.display = this.checked ? "inline" : "none";
    }
    if (foreignInfoBox) {
      foreignInfoBox.style.display = this.checked ? "block" : "none";
    }
  });
}

// Luk-kryds i infoboksen
if (foreignInfoClose && foreignInfoBox) {
  foreignInfoClose.addEventListener("click", function () {
    foreignInfoBox.style.display = "none";
  });
}

// Rute-felter
var routeFromInput = document.getElementById("routeFrom");
var routeToInput   = document.getElementById("routeTo");
var routeViaInput  = document.getElementById("routeVia");
var routeFromList  = document.getElementById("results-route-from");
var routeToList    = document.getElementById("results-route-to");
var routeViaList   = document.getElementById("results-route-via");

// Koordinater til rute
var routeFromCoord = null;
var routeToCoord   = null;
var routeViaCoord  = null;

function addClearButton(inputElement, listElement) {
  let btn = document.createElement("span");
  btn.innerHTML = "&times;";
  btn.classList.add("clear-button");
  inputElement.parentElement.appendChild(btn);

  // Vis/skjul krydset afhængigt af om der står noget i feltet
  inputElement.addEventListener("input", function () {
    btn.style.display = inputElement.value.length > 0 ? "inline" : "none";
  });

  // Klik på kryds = ryd felt, resultatliste, bokse og markør
  btn.addEventListener("click", function () {
    inputElement.value = "";
    listElement.innerHTML = "";
    listElement.style.display = "none";
    btn.style.display = "none";
    resetCoordinateBox();

    // Skjul info-bokse og kommune-overlay
    document.getElementById("infoBox").style.display = "none";
    document.getElementById("statsvejInfoBox").style.display = "none";
    document.getElementById("kommuneOverlay").style.display = "none";

        // Fjern markør – med respekt for "Behold markører" og "SharePoint markører"
    if (!shouldPreserveSelectionMarker() && currentMarker) {
      if (map.hasLayer(currentMarker)) {
        map.removeLayer(currentMarker);
      }
      currentMarker = null;
    }
  });

  // Backspace: når feltet er ved at blive tomt (0 tegn efter tast),
  // rydder vi resultater, bokse og markør – uden ekstra tryk
  inputElement.addEventListener("keydown", function (e) {
    if (e.key === "Backspace") {
      const currentLength = inputElement.value.length; // længde før tegnet slettes
      if (currentLength <= 1) {
        listElement.innerHTML = "";
        listElement.style.display = "none";
        resetCoordinateBox();

        document.getElementById("infoBox").style.display = "none";
        document.getElementById("statsvejInfoBox").style.display = "none";
        document.getElementById("kommuneOverlay").style.display = "none";

                if (!shouldPreserveSelectionMarker() && currentMarker) {
          if (map.hasLayer(currentMarker)) {
            map.removeLayer(currentMarker);
          }
          currentMarker = null;
        }
      }
    }
  });

  btn.style.display = "none";
}

addClearButton(vej1Input, vej1List);
addClearButton(vej2Input, vej2List);
// Clear-knapper til rute-felter
if (routeFromInput && routeFromList) addClearButton(routeFromInput, routeFromList);
if (routeToInput && routeToList)     addClearButton(routeToInput, routeToList);
if (routeViaInput && routeViaList)   addClearButton(routeViaInput, routeViaList);

/***************************************************
 * Globale arrays til piletaster
 ***************************************************/
var searchItems = [];
var searchCurrentIndex = -1;
var vej1Items = [];
var vej1CurrentIndex = -1;
var vej2Items = [];
var vej2CurrentIndex = -1;

// Piletaster til rute-felter
var routeFromItems = [];
var routeFromIndex = -1;
var routeToItems   = [];
var routeToIndex   = -1;
var routeViaItems  = [];
var routeViaIndex  = -1;

/***************************************************
 * Route-panel toggling
 ***************************************************/
var routePanel = document.getElementById("routePanel");
var routeToggleBtn = document.getElementById("routeToggleBtn");
if (routeToggleBtn && routePanel) {
  routeToggleBtn.addEventListener("click", function() {
    routePanel.classList.toggle("hidden");
  });
}

/***************************************************
 * Hjælper: udfyld rute-felter ved klik på kort
 ***************************************************/
function fillRouteFieldsFromClick(data, lat, lon) {
  if (!routePanel || routePanel.classList.contains("hidden")) return;

  const vejnavn = data?.adgangsadresse?.vejnavn || data.vejnavn || "";
  const husnr   = data?.adgangsadresse?.husnr   || data.husnr   || "";
  const postnr  = data?.adgangsadresse?.postnr  || data.postnr  || "";
  const postnavn = data?.adgangsadresse?.postnrnavn || data.postnrnavn || "";

  if (!vejnavn && !postnr && !postnavn) return;

  const addrText = `${vejnavn} ${husnr}, ${postnr} ${postnavn}`.trim();

  if (routeFromInput && !routeFromInput.value) {
    routeFromInput.value = addrText;
    routeFromCoord = [lat, lon];
  } else if (routeToInput && !routeToInput.value) {
    routeToInput.value = addrText;
    routeToCoord = [lat, lon];
  } else if (routeViaInput) {
    routeViaInput.value = addrText;
    routeViaCoord = [lat, lon];
  }
}

/***************************************************
 * Hoved-søg (#search) => doSearch
 ***************************************************/
const debouncedMainSearch = debounce(function(queryText) {
  doSearch(queryText, resultsList);
}, 350);
searchInput.addEventListener("input", function() {
  // Ny søgning: skjul info-bokse, marker mv.
  document.getElementById("infoBox").style.display = "none";
  document.getElementById("statsvejInfoBox").style.display = "none";
    if (!shouldPreserveSelectionMarker() && currentMarker) {
    if (map.hasLayer(currentMarker)) {
      map.removeLayer(currentMarker);
    }
    currentMarker = null;
  }
  resetCoordinateBox();

  const txt = searchInput.value.trim();

  // Hvis brugeren skriver koordinater "lat, lon"
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
        resultsList.style.display = "none";
        placeMarkerAndZoom(
          [latNum, lonNum],
          `Koordinater: ${latNum.toFixed(5)}, ${lonNum.toFixed(5)}`
        );
        setCoordinateBox(latNum, lonNum);
        updateInfoBox(data, latNum, lonNum);
      })
      .catch(err => console.error("Reverse geocoding fejl:", err));
    return;
  }

  // Tomt felt => ryd alt
  if (txt.length === 0) {
    clearBtn.style.display = "none";
    resultsList.innerHTML = "";
    resultsList.style.display = "none";
    document.getElementById("infoBox").style.display = "none";
    searchItems = [];
    return;
  }

  // Hvis Strandposter-laget er aktivt, laver vi en lokal søgning
  // uden debounce og uden min. længde
  if (map.hasLayer(redningsnrLayer)) {
    quickStrandSearch(txt);
  }

  // For at skåne eksterne API'er beholder vi stadig
  // min. 3 tegn + debounce for de almindelige søgninger
  if (txt.length < 3) {
    clearBtn.style.display = "inline";
    return;
  }

  clearBtn.style.display = "inline";
  debouncedMainSearch(txt);
});
  
searchInput.addEventListener("keydown", function(e) {
  if (e.key === "ArrowDown") {
    if (searchItems.length === 0) return;
    e.preventDefault();
    searchCurrentIndex = (searchCurrentIndex + 1) % searchItems.length;
    highlightSearchItem();
  } else if (e.key === "ArrowUp") {
    if (searchItems.length === 0) return;
    e.preventDefault();
    searchCurrentIndex = (searchCurrentIndex + searchItems.length - 1) % searchItems.length;
    highlightSearchItem();
  } else if (e.key === "Enter") {
    if (searchItems.length === 0) return;
    e.preventDefault();
    if (searchCurrentIndex >= 0) {
      searchItems[searchCurrentIndex].click();
    }
  } else if (e.key === "Backspace") {
    // Når feltet bliver tømt med backspace, skal resultatliste, markør og infobokse væk
    const currentLength = searchInput.value.length; // længde før tegnet slettes
    if (currentLength <= 1) {
      resultsList.innerHTML = "";
      resultsList.style.display = "none";
      searchItems = [];
      searchCurrentIndex = -1;

      document.getElementById("infoBox").style.display = "none";
      document.getElementById("statsvejInfoBox").style.display = "none";
      document.getElementById("kommuneOverlay").style.display = "none";
      resetCoordinateBox();

      if (!shouldPreserveSelectionMarker() && currentMarker) {
  if (map.hasLayer(currentMarker)) {
    map.removeLayer(currentMarker);
  }
  currentMarker = null;
}
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
  searchInput.value = "";
  clearBtn.style.display = "none";
  document.getElementById("infoBox").style.display = "none";
  document.getElementById("statsvejInfoBox").style.display = "none";
  resetCoordinateBox();
  resetInfoBox();
  searchInput.focus();
  if (!shouldPreserveSelectionMarker() && currentMarker) {
  if (map.hasLayer(currentMarker)) {
    map.removeLayer(currentMarker);
  }
  currentMarker = null;
}
  resultsList.innerHTML = "";
  resultsList.style.display = "none";
  document.getElementById("kommuneOverlay").style.display = "none";
});

/***************************************************
 * Vej1 / Vej2
 ***************************************************/
const debouncedVej1Search = debounce(function(searchText) {
  doSearchRoad(searchText, vej1List, vej1Input, "vej1");
}, 350);

const debouncedVej2Search = debounce(function(searchText) {
  doSearchRoad(searchText, vej2List, vej2Input, "vej2");
}, 350);
vej1Input.addEventListener("input", function() {
  const txt = vej1Input.value.trim();
  if (txt.length < 3) {
    vej1List.innerHTML = "";
    vej1List.style.display = "none";
    vej1Items = [];
    return;
  }
  debouncedVej1Search(txt);
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

vej2Input.addEventListener("input", function() {
  const txt = vej2Input.value.trim();
  if (txt.length < 3) {
    vej2List.innerHTML = "";
    vej2List.style.display = "none";
    vej2Items = [];
    return;
  }
  debouncedVej2Search(txt);
});
vej2Input.addEventListener("keydown", function(e) {
  document.getElementById("infoBox").style.display = "none";
  if (vej2Items.length === 0) {
    if (e.key === "Backspace" && vej2Input.value.length === 0) {
      resetCoordinateBox();
      vej2List.innerHTML = "";
      vej2List.style.display = "none";
    }
    return;
  }
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
      vej2List.innerHTML = "";
      vej2List.style.display = "none";
    }
  }
});
function highlightVej2Item() {
  vej2Items.forEach(li => li.classList.remove("highlight"));
  if (vej2CurrentIndex >= 0 && vej2CurrentIndex < vej2Items.length) {
    vej2Items[vej2CurrentIndex].classList.add("highlight");
  }
}

function resetInfoBox() {
  document.getElementById("extra-info").textContent = "";
  document.getElementById("skraafotoLink").style.display = "none";
}

vej1Input.parentElement.querySelector(".clear-button").addEventListener("click", function() {
  vej1Input.value = "";
  vej1List.innerHTML = "";
  vej1List.style.display = "none";
  document.getElementById("infoBox").style.display = "none";
  resetCoordinateBox();
});

vej2Input.parentElement.querySelector(".clear-button").addEventListener("click", function() {
  vej2Input.value = "";
  vej2List.innerHTML = "";
  vej2List.style.display = "none";
  document.getElementById("infoBox").style.display = "none";
  resetCoordinateBox();
});

/***************************************************
 * Rute-felter: søgning i Dataforsyningen
 ***************************************************/
function doRouteSearch(query, listElement, type) {
  let url = `https://api.dataforsyningen.dk/adgangsadresser/autocomplete?q=${encodeURIComponent(query)}&per_side=10`;
  fetch(url)
    .then(response => response.json())
    .then(data => {
      listElement.innerHTML = "";

      let itemsArray;
      if (type === "from") {
        routeFromItems = [];
        routeFromIndex = -1;
        itemsArray = routeFromItems;
      } else if (type === "to") {
        routeToItems = [];
        routeToIndex = -1;
        itemsArray = routeToItems;
      } else {
        routeViaItems = [];
        routeViaIndex = -1;
        itemsArray = routeViaItems;
      }

      data.forEach(item => {
        let li = document.createElement("li");
        li.textContent = item.tekst;
        li.addEventListener("click", function() {
          selectRouteSuggestion(item, type, listElement);
        });
        listElement.appendChild(li);
        itemsArray.push(li);
      });
      listElement.style.display = data.length > 0 ? "block" : "none";
    })
    .catch(err => console.error("Fejl i doRouteSearch:", err));
}

function selectRouteSuggestion(item, type, listElement) {
  const input = type === "from" ? routeFromInput : type === "to" ? routeToInput : routeViaInput;
  input.value = item.tekst || "";
  listElement.innerHTML = "";
  listElement.style.display = "none";

  const adgangsId = item.adgangsadresse && item.adgangsadresse.id;
  if (!adgangsId) {
    console.error("Ingen adgangsadresse.id for rute-forslag");
    return;
  }
  const detailUrl = `https://api.dataforsyningen.dk/adgangsadresser/${adgangsId}`;
  fetch(detailUrl)
    .then(r => r.json())
    .then(addr => {
      let coords = addr.adgangspunkt?.koordinater;
      if (!coords || coords.length < 2) return;
      const lon = coords[0];
      const lat = coords[1];
      if (type === "from") {
        routeFromCoord = [lat, lon];
      } else if (type === "to") {
        routeToCoord = [lat, lon];
      } else {
        routeViaCoord = [lat, lon];
      }
    })
    .catch(err => console.error("Fejl i selectRouteSuggestion:", err));
}

function highlightRouteItem(type) {
  let items, idx;
  if (type === "from") {
    items = routeFromItems;
    idx = routeFromIndex;
  } else if (type === "to") {
    items = routeToItems;
    idx = routeToIndex;
  } else {
    items = routeViaItems;
    idx = routeViaIndex;
  }
  if (!items) return;
  items.forEach(li => li.classList.remove("highlight"));
  if (idx >= 0 && idx < items.length) {
    items[idx].classList.add("highlight");
  }
}

function setupRouteInputHandlers(inputElement, listElement, type) {
  if (!inputElement || !listElement) return;

  const debouncedRouteSearch = debounce(function(searchText) {
    doRouteSearch(searchText, listElement, type);
  }, 350);

  inputElement.addEventListener("input", function() {
    const txt = inputElement.value.trim();
    if (txt.length < 3) {
      listElement.innerHTML = "";
      listElement.style.display = "none";
      if (type === "from") {
        routeFromItems = [];
        routeFromIndex = -1;
        routeFromCoord = null;
      } else if (type === "to") {
        routeToItems = [];
        routeToIndex = -1;
        routeToCoord = null;
      } else {
        routeViaItems = [];
        routeViaIndex = -1;
        routeViaCoord = null;
      }
      return;
    }
    debouncedRouteSearch(txt);
  });

  inputElement.addEventListener("keydown", function(e) {
    let items;
    if (type === "from") {
      items = routeFromItems;
    } else if (type === "to") {
      items = routeToItems;
    } else {
      items = routeViaItems;
    }
    if (!items || items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (type === "from") {
        routeFromIndex = (routeFromIndex + 1) % items.length;
      } else if (type === "to") {
        routeToIndex = (routeToIndex + 1) % items.length;
      } else {
        routeViaIndex = (routeViaIndex + 1) % items.length;
      }
      highlightRouteItem(type);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (type === "from") {
        routeFromIndex = (routeFromIndex + items.length - 1) % items.length;
      } else if (type === "to") {
        routeToIndex = (routeToIndex + items.length - 1) % items.length;
      } else {
        routeViaIndex = (routeViaIndex + items.length - 1) % items.length;
      }
      highlightRouteItem(type);
    } else if (e.key === "Enter") {
      e.preventDefault();
      let idx;
      if (type === "from") idx = routeFromIndex;
      else if (type === "to") idx = routeToIndex;
      else idx = routeViaIndex;

      if (idx >= 0 && idx < items.length) {
        items[idx].click();
      }
    }
  });
}

setupRouteInputHandlers(routeFromInput, routeFromList, "from");
setupRouteInputHandlers(routeToInput,   routeToList,   "to");
setupRouteInputHandlers(routeViaInput,  routeViaList,  "via");

/***************************************************
 * Globale variabler til at gemme valgte veje (Find X)
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
  return new Promise((resolve) => {
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
 * Hurtig søgning kun i strandposter (uden debounce)
 * Bruges når "Strandposter"-laget er tændt
 ***************************************************/
function handleStrandpostClick(obj, listElement) {
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

      if (marker) {
        if (!marker._meta) marker._meta = {};
marker._meta.dkReverseData = revData;
marker._meta.foreignFeature = null;
setMarkerHoverAddress(marker, `${obj.tekst} – ${adresseStr}`);
attachKeepMarkerBehaviors(marker);
setActiveInfoMarker(marker);
        marker.bindPopup(`
          <strong>${obj.tekst}</strong><br>
          ${adresseStr}<br>
          <a href="#" title="Kopier til Eva.net" onclick="(function(el){ el.style.color='red'; copyToClipboard('${evaFormat}'); showCopyPopup('Kopieret'); setTimeout(function(){ el.style.color=''; },1000); })(this); return false;">Eva.Net</a>
          &nbsp;
          <a href="#" title="Kopier til Notes" onclick="(function(el){ el.style.color='red'; copyToClipboard('${notesFormat}'); showCopyPopup('Kopieret'); setTimeout(function(){ el.style.color=''; },1000); })(this); return false;">Notes</a>
        `).openPopup();

        marker.on("popupclose", function () {
  // I keep-mode skal markøren blive stående (kun slettes via højreklik eller layer off)
  if (!keepMarkersEnabled) {
    map.removeLayer(marker);
    currentMarker = null;
    setActiveInfoMarker(null);
  }

  document.getElementById("infoBox").style.display = "none";
  document.getElementById("statsvejInfoBox").style.display = "none";
  document.getElementById("kommuneOverlay").style.display = "none";
  resetCoordinateBox();
  resultsList.innerHTML = "";
  resultsList.style.display = "none";
});
      }
    })
    .catch(err => {
      console.error("Reverse geocoding for strandpost fejlede:", err);
      if (marker) {
        marker.bindPopup(`<strong>${obj.tekst}</strong><br>(Reverse geocoding fejlede)`).openPopup();
      }
    });
}

function quickStrandSearch(query) {
  // Skal kun bruges når Strandposter-laget er aktivt
  if (!map.hasLayer(redningsnrLayer)) return;

  doSearchStrandposter(query)
    .then(strandResults => {
      resultsList.innerHTML = "";
      searchItems = [];
      searchCurrentIndex = -1;

      strandResults.forEach(obj => {
        const li = document.createElement("li");
        li.innerHTML = `🛟 ${obj.tekst}`;
        li.addEventListener("click", function() {
          handleStrandpostClick(obj, resultsList);
        });
        resultsList.appendChild(li);
        searchItems.push(li);
      });

      resultsList.style.display = strandResults.length > 0 ? "block" : "none";
    })
    .catch(err => {
      console.error("Fejl i quickStrandSearch:", err);
    });
}

/***************************************************
 * doSearch => kombinerer adresser, stednavne, specialsteder,
 * navngivne veje, strandposter, statsveje og ORS-adresser
 ***************************************************/
function doSearch(query, listElement) {
  let addrUrl = `https://api.dataforsyningen.dk/adgangsadresser/autocomplete?q=${encodeURIComponent(query)}&per_side=50`;
  let stedUrl = `https://api.dataforsyningen.dk/rest/gsearch/v2.0/stednavn?q=${encodeURIComponent(query)}&limit=50&token=a63a88838c24fc85d47f32cde0ec0144`;
  const queryWithWildcard = query.trim().split(/\s+/).map(w => w + "*").join(" ");
  let roadUrl = `https://api.dataforsyningen.dk/navngivneveje?q=${encodeURIComponent(queryWithWildcard)}&per_side=20`;

  // Strandposter (kun når laget er tændt og data er klar)
  let strandPromiseBase = (map.hasLayer(redningsnrLayer) && strandposterReady)
    ? doSearchStrandposter(query)
    : Promise.resolve([]);
  
  // Evt. egne special-steder
  let lowerQuery = query.toLowerCase();
  let customResults = customPlaces
    .filter(function(p) {
      let navnMatch     = p.navn && p.navn.toLowerCase().includes(lowerQuery);
      let adresseMatch  = p.adresse && p.adresse.toLowerCase().includes(lowerQuery);
      let kortnavnMatch = p.kortnavn && p.kortnavn.toLowerCase().includes(lowerQuery);
      return navnMatch || adresseMatch || kortnavnMatch;
    })
    .map(function(p) {
      return {
        type: "custom",
        navn: p.navn || "",
        adresse: p.adresse || "",
        coords: p.coords,
        data: p
      };
    });

  // Statsveje – punkter med mere detaljeret motorvejs-info
  let statsvejsResults = statsveje
    .filter(function(p) {
      let navnMatch    = p.navn && p.navn.toLowerCase().includes(lowerQuery);
      let adrMatch     = p.adresse && p.adresse.toLowerCase().includes(lowerQuery);
      let forkortMatch = p.adresseForkortelse && p.adresseForkortelse.toLowerCase().includes(lowerQuery);
      let ruteMatch    = p.ruteNr && String(p.ruteNr).toLowerCase().includes(lowerQuery);
      return navnMatch || adrMatch || forkortMatch || ruteMatch;
    })
    .map(function(p) {
      return {
        type: "statsvej",
        navn: p.navn || "",
        adresse: p.adresse || "",
        coords: p.coords,
        data: p
      };
    });

  // Udlands-tilstand styres af checkboxen (Udland)
  const foreignToggleEl =
    foreignSearchToggle ||
    document.getElementById("enableForeignSearch") ||
    document.getElementById("foreignSearchToggle") ||
    document.getElementById("foreignSearch");
  const foreignOnly = !!(foreignToggleEl && foreignToggleEl.checked);

  // Promises til de forskellige datakilder
  let addrPromise;
  let stedPromise;
  let roadPromise;
  let strandPromise;
  let orsPromise;

  if (foreignOnly) {
    // Når "Udland" er slået til:
    //  - ingen Dataforsyningen-søgninger
    //  - kun ORS (udenlandske adresser)
    addrPromise   = Promise.resolve([]);
    stedPromise   = Promise.resolve({});
    roadPromise   = Promise.resolve([]);
    strandPromise = Promise.resolve([]);
    orsPromise    = geocodeORSForSearch(query);
  } else {
    // Normal tilstand: danske kilder + lokale data
    addrPromise = fetch(addrUrl)
      .then(r => r.json())
      .catch(err => { console.error("Adresser fejl:", err); return []; });

    stedPromise = fetch(stedUrl)
      .then(r => r.json())
      .catch(err => { console.error("Stednavne fejl:", err); return {}; });

    roadPromise = fetch(roadUrl)
      .then(r => r.json())
      .catch(err => { console.error("Navngivne veje fejl:", err); return []; });

    strandPromise = strandPromiseBase;

    // ORS skal ikke kaldes, når Udland ikke er valgt
    orsPromise = Promise.resolve([]);
  }

  Promise.all([
    addrPromise,
    stedPromise,
    roadPromise,
    strandPromise,
    orsPromise
  ])
  .then(([addrData, stedData, roadData, strandData, orsData]) => {
    listElement.innerHTML = "";
    searchItems = [];
    searchCurrentIndex = -1;

    // Adresser (Dataforsyningen)
    let addrResults = (addrData || []).map(item => ({
      type: "adresse",
      tekst: item.tekst,
      adgangsadresse: item.adgangsadresse
    }));

    // Stednavne
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

    // Navngivne veje
    let roadResults = (roadData || []).map(item => ({
      type: "navngivenvej",
      navn: item.navn || item.adresseringsnavn || "",
      id: item.id,
      visualCenter: item.visueltcenter,
      bbox: item.bbox
    }));

    // Udenlandske adresser fra ORS
    let orsResults = (orsData || []).map(o => o);

    // Samlet liste
    let combined;
    if (foreignOnly) {
      // Når "Udland" er slået til: KUN udenlandske adresser
      combined = [
        ...orsResults
      ];
    } else {
      // Normal tilstand: danske kilder + egne steder + statsveje
      combined = [
        ...addrResults,
        ...stedResults,
        ...roadResults,
        ...(strandData || []),
        ...customResults,
        ...statsvejsResults,
        ...orsResults
      ];
    }

    // Sortering – navne-typer (stednavn, navngiven vej, custom, statsvej, ORS) først
    combined.sort((a, b) => {
      const aIsName = (
        a.type === "stednavn" ||
        a.type === "navngivenvej" ||
        a.type === "custom" ||
        a.type === "statsvej" ||
        a.type === "ors_foreign"
      );
      const bIsName = (
        b.type === "stednavn" ||
        b.type === "navngivenvej" ||
        b.type === "custom" ||
        b.type === "statsvej" ||
        b.type === "ors_foreign"
      );
      if (aIsName && !bIsName) return -1;
      if (!aIsName && bIsName) return 1;
      return getSortPriority(a, query) - getSortPriority(b, query);
    });

    // Byg liste-elementer
    combined.forEach(obj => {
      let li = document.createElement("li");
      if (obj.type === "strandpost") {
        li.innerHTML = `🛟 ${obj.tekst}`;
      } else if (obj.type === "adresse") {
        li.innerHTML = `🏠 ${obj.tekst}`;
      } else if (obj.type === "navngivenvej") {
        li.innerHTML = `🛣️ ${obj.navn}`;
      } else if (obj.type === "stednavn") {
        li.innerHTML = `📍 ${obj.navn}`;
      } else if (obj.type === "custom") {
        let extra = obj.adresse ? " – " + obj.adresse : "";
        li.innerHTML = `⭐ ${obj.navn}${extra}`;
      } else if (obj.type === "statsvej") {
        let extraStats = obj.adresse ? " – " + obj.adresse : "";
        li.innerHTML = `🛣️ ${obj.navn}${extraStats}`;
      } else if (obj.type === "ors_foreign") {
        li.innerHTML = `🌍 ${obj.label}`;
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
  .then(async reverseData => {
    updateInfoBox(reverseData, lat, lon);

    // Hvis SharePoint overlay er aktivt => gem markøren i SharePoint
    if (isSharePointOverlayActive()) {
      const addressText =
        reverseData?.adgangsadresse?.adressebetegnelse ||
        reverseData?.adressebetegnelse ||
        (obj.tekst || "");

      const postnr =
  reverseData?.adgangsadresse?.postnr ??
  reverseData?.postnr ??
  "";

const payload = {
  Title: "Markør",
  Lat: lat,
  Lon: lon,
  AddressText: addressText,
  Note: "",
  Postnr: postnr ? String(postnr) : ""
};

                          // Dedupe: brug stabil markerId (samme koordinat => samme id => ingen dubletter)
                    const stableId = makeStableMarkerId(lat, lon, 5);
                    payload.markerId = stableId;

                    // Hvis vi allerede har set denne markerId i denne session, så skip POST (undgår dublet)
                    if (stableId && spMarkerIndex.has(stableId)) {
                      // Sikr at markerens meta også er sat
                      if (currentMarker) {
                        if (!currentMarker._meta) currentMarker._meta = {};
                        currentMarker._meta._spMarkerId = stableId;

                        const known = spMarkerIndex.get(stableId);
                        if (known && known.itemId) {
                          currentMarker._meta._spItemId = known.itemId;
                        }
                        attachSharePointMarkerBehaviors(currentMarker);
                      }
                    } else {
                      const saved = await saveSharePointMarker(payload);

                      // Gem markerId på markøren (det er det worker sletter på i option A)
                      if (saved && saved.ok && currentMarker) {
                        if (!currentMarker._meta) currentMarker._meta = {};

                        // Worker returnerer markerId + createdItemId
                        currentMarker._meta._spMarkerId =
                          saved.markerId ||
                          stableId ||
                          null;

                        currentMarker._meta._spItemId =
                          saved.createdItemId || null;

                        // Opdater index, så næste gang undgår vi dublet
                        if (currentMarker._meta._spMarkerId) {
                          spMarkerIndex.set(currentMarker._meta._spMarkerId, {
                            marker: currentMarker,
                            itemId: currentMarker._meta._spItemId
                          });
                        }

                        attachSharePointMarkerBehaviors(currentMarker);
                      }
                    }
    }
  })
  .catch(err => console.error("Reverse geocoding fejl:", err));
              resultsList.innerHTML = "";
              resultsList.style.display = "none";
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
          handleStrandpostClick(obj, listElement);
        } else if (obj.type === "custom") {
          let coordsCustom = obj.coords;
          if (!coordsCustom || coordsCustom.length < 2) return;
          let lat = coordsCustom[0];
          let lon = coordsCustom[1];
          setCoordinateBox(lat, lon);
          placeMarkerAndZoom([lat, lon], obj.navn);
          let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${lon}&y=${lat}&struktur=flad`;
          fetch(revUrl)
            .then(r => r.json())
            .then(revData => {
              updateInfoBox(revData, lat, lon);
            })
            .catch(err => console.error("Reverse geocoding fejl for specialsted:", err));
          listElement.innerHTML = "";
          listElement.style.display = "none";
        } else if (obj.type === "statsvej") {
          let coordsStats = obj.coords;
          if (!coordsStats || coordsStats.length < 2) return;
          let lat = coordsStats[0];
          let lon = coordsStats[1];
          setCoordinateBox(lat, lon);
          placeMarkerAndZoom([lat, lon], obj.navn);
          let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${lon}&y=${lat}&struktur=flad`;
          fetch(revUrl)
            .then(r => r.json())
            .then(revData => {
              updateInfoBox(revData, lat, lon);
            })
            .catch(err => console.error("Reverse geocoding fejl for statsvej:", err));
          listElement.innerHTML = "";
          listElement.style.display = "none";
        } else if (obj.type === "navngivenvej") {
          let lat, lon;
          if (Array.isArray(obj.visualCenter) && obj.visualCenter.length === 2) {
            lon = obj.visualCenter[0];
            lat = obj.visualCenter[1];
          } else if (Array.isArray(obj.bbox) && obj.bbox.length === 4) {
            const [minLon, minLat, maxLon, maxLat] = obj.bbox;
            lon = (minLon + maxLon) / 2;
            lat = (minLat + maxLat) / 2;
          } else {
            return;
          }
          setCoordinateBox(lat, lon);
          placeMarkerAndZoom([lat, lon], obj.navn);
          let revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${lon}&y=${lat}&struktur=flad`;
          fetch(revUrl)
            .then(r => r.json())
            .then(revData => {
              updateInfoBox(revData, lat, lon);
            })
            .catch(err => console.error("Reverse geocoding fejl for navngiven vej:", err));
          listElement.innerHTML = "";
          listElement.style.display = "none";
        } else if (obj.type === "ors_foreign") {
          // Udenlandsk adresse fra ORS
          const lat = obj.lat;
          const lon = obj.lon;
          setCoordinateBox(lat, lon);
          placeMarkerAndZoom([lat, lon], obj.label);
          updateInfoBoxForeign(obj.feature, lat, lon);

          // Udfyld rute-felter
          const p = obj.feature.properties || {};
          const norm = {
            vejnavn: p.street || p.name || "",
            husnr: p.housenumber || "",
            postnr: p.postalcode || "",
            postnrnavn: p.locality || p.region || p.country || ""
          };
          fillRouteFieldsFromClick(norm, lat, lon);

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
 * placeMarkerAndZoom – bruger createSelectionMarker
 ***************************************************/
function placeMarkerAndZoom(coords, displayText) {
  if (coords[0] > 90 || coords[1] > 90) {
    let converted = convertToWGS84(coords[0], coords[1]);
    coords = converted;
  }
  let lat = coords[0], lon = coords[1];

  // Brug fælles helper, så den respekterer "Behold markører"
  createSelectionMarker(lat, lon);

  map.setView([lat, lon], 16);
  document.getElementById("address").textContent = displayText;
  const streetviewLink = document.getElementById("streetviewLink");
  streetviewLink.href = `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lon}`;
  document.getElementById("infoBox").style.display = "block";
}

/***************************************************
 * checkForStatsvej
 ***************************************************/
async function checkForStatsvej(lat, lon) {
  let [utmX, utmY] = proj4("EPSG:4326", "EPSG:25832", [lon, lat]);
  let buffer = 100;
  let bbox = `${utmX - buffer},${utmY - buffer},${utmX + buffer},${utmY + buffer}`;
  let url = `https://geocloud.vd.dk/CVF/wms?
SERVICE=WMS&
VERSION=1.1.1&
REQUEST=GetFeatureInfo&
INFO_FORMAT=application/json&
TRANSPARENT=true&
LAYERS=CVF:veje&
QUERY_LAYERS=CVF:veje&
SRS=EPSG:25832&
WIDTH=101&
HEIGHT=101&
BBOX=${bbox}&
X=50&
Y=50`;
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
 * getKmAtPoint – henter km via Cloudflare-worker
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
 * Statsvej / info-bokse close-knapper
 ***************************************************/
const statsvejInfoBox = document.getElementById("statsvejInfoBox");
const statsvejCloseBtn = document.getElementById("statsvejCloseBtn");
statsvejCloseBtn.addEventListener("click", function() {
  statsvejInfoBox.style.display = "none";
  document.getElementById("infoBox").style.display = "none";
  resetCoordinateBox();
  if (!shouldPreserveSelectionMarker() && currentMarker) {
  if (map.hasLayer(currentMarker)) {
    map.removeLayer(currentMarker);
  }
  currentMarker = null;
}
});
const infoCloseBtn = document.getElementById("infoCloseBtn");
infoCloseBtn.addEventListener("click", function() {
  document.getElementById("infoBox").style.display = "none";
  document.getElementById("statsvejInfoBox").style.display = "none";
  if (!shouldPreserveSelectionMarker() && currentMarker) {
  if (map.hasLayer(currentMarker)) {
    map.removeLayer(currentMarker);
  }
  currentMarker = null;
}
  resetCoordinateBox();
  resultsList.innerHTML = "";
  resultsList.style.display = "none";
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
 * Distance Options – cirkler
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

/***************************************************
 * DOMContentLoaded
 ***************************************************/
document.addEventListener("DOMContentLoaded", function() {
  document.getElementById("search").focus();

  const planBtn = document.getElementById("planRouteBtn");
  if (planBtn) {
    planBtn.addEventListener("click", function() {
      planRouteORS();
    });
  }

  const clearRouteBtn = document.getElementById("clearRouteBtn");
  if (clearRouteBtn) {
    clearRouteBtn.addEventListener("click", function() {
      if (routeFromInput) routeFromInput.value = "";
      if (routeToInput)   routeToInput.value   = "";
      if (routeViaInput)  routeViaInput.value  = "";
      routeFromCoord = null;
      routeToCoord   = null;
      routeViaCoord  = null;

      if (routeFromList) {
        routeFromList.innerHTML = "";
        routeFromList.style.display = "none";
      }
      if (routeToList) {
        routeToList.innerHTML = "";
        routeToList.style.display = "none";
      }
      if (routeViaList) {
        routeViaList.innerHTML = "";
        routeViaList.style.display = "none";
      }

      const routeSummaryEl = document.getElementById("routeSummary");
      if (routeSummaryEl) {
        routeSummaryEl.textContent = "";
      }

      routeLayer.clearLayers();

      // Ryd kun markør, hvis vi IKKE er i "Behold markører"-tilstand
      if (!shouldPreserveSelectionMarker() && currentMarker) {
  if (map.hasLayer(currentMarker)) {
    map.removeLayer(currentMarker);
  }
  currentMarker = null;
}
      resetCoordinateBox();
    });
  }

    // Deaktivér "Udland"-søgning hvis ORS-nøgle mangler
  if (foreignSearchToggle && (!ORS_API_KEY || ORS_API_KEY.includes("YOUR_ORS_API_KEY"))) {
    foreignSearchToggle.checked = false;
    foreignSearchToggle.disabled = true;
    foreignSearchToggle.title = "Udland-søgning kræver en gyldig OpenRouteService API-nøgle";

    // Sørg for at infoboksen ikke vises, hvis Udland ikke kan bruges
    if (foreignInfoBox) {
      foreignInfoBox.style.display = "none";
    }
  }

  // Auto-opdater rute når profil/præference ændres – men kun hvis der allerede er en rute
  const routeProfileSel    = document.getElementById("routeProfile");
  const routePreferenceSel = document.getElementById("routePreference");

  function autoRecalculateRoute() {
    if (!routeLayer) return;
    const hasRoute = routeLayer.getLayers().length > 0;
    if (hasRoute) {
      planRouteORS();
    }
  }

  if (routeProfileSel) {
    routeProfileSel.addEventListener("change", autoRecalculateRoute);
  }
  if (routePreferenceSel) {
    routePreferenceSel.addEventListener("change", autoRecalculateRoute);
  }
  
});
// ===============================
// SharePoint Worker config (COOKIE AUTH)
// ===============================
const SP_WORKER_BASE = "https://danmarkskort-sp.anderskabel8.workers.dev";
const SP_WORKSPACE = "Test";
const SP_MAP_ID = "default";
// Områder konfiguration (ligger som fil i GitHub)
const SP_AREAS_URL = "sp-areas.json"; // <-- filen du opretter i repo

let spAreasConfig = { areas: [{ key: "all", label: "Alle områder", ranges: [] }] };
let spSelectedAreaKey = localStorage.getItem("spSelectedAreaKey") || "all";

async function loadSpAreasConfig() {
  try {
    const resp = await fetch(SP_AREAS_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error("Kunne ikke hente " + SP_AREAS_URL);
    const json = await resp.json();
    if (json && Array.isArray(json.areas) && json.areas.length) {
      spAreasConfig = json;
    }
  } catch (e) {
    console.warn("Fejl ved hentning af område-konfig, bruger fallback:", e);
  }

  // Byg dropdown options
  if (spAreaSelect) {
    spAreaSelect.innerHTML = "";
    (spAreasConfig.areas || []).forEach(a => {
      const opt = document.createElement("option");
      opt.value = a.key;
      opt.textContent = a.label || a.key;
      spAreaSelect.appendChild(opt);
    });

    // Bevar tidligere valg hvis muligt
    const exists = (spAreasConfig.areas || []).some(a => a.key === spSelectedAreaKey);
    spAreaSelect.value = exists ? spSelectedAreaKey : "all";
    spSelectedAreaKey = spAreaSelect.value;
    localStorage.setItem("spSelectedAreaKey", spSelectedAreaKey);
  }
}

function spAreaAllowsPostnr(postnr) {
  // Hvis ingen postnr, så lad den passere (så vi ikke “mister” data)
  if (postnr == null || !isFinite(postnr)) return true;

  const area = (spAreasConfig.areas || []).find(a => a.key === spSelectedAreaKey) ||
               (spAreasConfig.areas || []).find(a => a.key === "all") ||
               { ranges: [] };

  // all eller ingen ranges => alt tilladt
  if (!area.ranges || area.ranges.length === 0 || spSelectedAreaKey === "all") return true;

  // match ranges
  for (const r of area.ranges) {
    const from = Number(r?.[0]);
    const to = Number(r?.[1]);
    if (isFinite(from) && isFinite(to) && postnr >= from && postnr <= to) return true;
  }
  return false;
}

// ===============================
// SharePoint auth/session helpers
// ===============================
let spLoginInProgress = false;

/**
 * Sikrer at vi har en gyldig session-cookie i browseren.
 * Vi gemmer IKKE koden nogen steder.
 */
async function spEnsureLoggedIn() {
  if (spLoginInProgress) return false;
  spLoginInProgress = true;

  try {
    // Hurtig test: er vi allerede logget ind?
    try {
      const meResp = await fetch(`${SP_WORKER_BASE}/auth/me`, {
        method: "GET",
        credentials: "include"
      });
      if (meResp.ok) return true;
    } catch (e) {}

    const code = prompt("Indtast adgangskoden til SharePoint-markører:");
    if (!code || !code.trim()) return false;

    const loginResp = await fetch(`${SP_WORKER_BASE}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() })
    });

    if (!loginResp.ok) {
      alert("Forkert kode eller login fejlede.");
      return false;
    }

    return true;
  } finally {
    spLoginInProgress = false;
  }
}

/**
 * Wrapper til kald mod worker som:
 * - sender cookies (credentials: include)
 * - hvis 401 => spørger efter kode og retry én gang
 */
async function spFetch(path, options) {
  const url = `${SP_WORKER_BASE}${path}`;

  const opts = Object.assign({}, options || {});
  opts.credentials = "include";

  if (!opts.headers) opts.headers = {};

  let resp = await fetch(url, opts);

  if (resp.status === 401) {
    const ok = await spEnsureLoggedIn();
    if (!ok) return resp;

    resp = await fetch(url, opts);
  }

  return resp;
}

// ===============================
// SharePoint dedupe helpers (stable markerId + in-memory index)
// ===============================
const spMarkerIndex = new Map();

// ===============================
// Område-filter (SharePoint) helpers
// - Områder ligger i sp-areas.json på GitHub (samme origin)
// - Filter bruges kun ved loadSharePointMarkers()
// ===============================
let spAreasConfig = { areas: [{ id: "all", name: "Alle", postnrs: [] }] };

async function spLoadAreasConfig() {
  try {
    // cache-bust så ændringer på GitHub slår igennem
    const resp = await fetch(`sp-areas.json?v=${Date.now()}`, { cache: "no-store" });
    if (!resp.ok) throw new Error("Kunne ikke hente sp-areas.json");
    const data = await resp.json();
    if (data && Array.isArray(data.areas) && data.areas.length) {
      spAreasConfig = data;
    }
  } catch (e) {
    console.warn("spLoadAreasConfig fejlede (fallback til default):", e);
  }
}

function spPopulateAreaSelect() {
  if (!spAreaSelect) return;

  const areas = Array.isArray(spAreasConfig.areas) ? spAreasConfig.areas : [];
  spAreaSelect.innerHTML = "";

  // Sikr at "all" altid findes
  const hasAll = areas.some(a => String(a.id) === "all");
  if (!hasAll) {
    const opt = document.createElement("option");
    opt.value = "all";
    opt.textContent = "Alle";
    spAreaSelect.appendChild(opt);
  }

  areas.forEach(a => {
    const id = String(a.id || "").trim();
    const name = String(a.name || a.id || "").trim();
    if (!id || !name) return;

    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = name;
    spAreaSelect.appendChild(opt);
  });

  // default til all hvis tom/ukendt
  if (!spAreaSelect.value) spAreaSelect.value = "all";
}

function spGetSelectedAreaId() {
  if (!spAreaSelect) return "all";
  return String(spAreaSelect.value || "all");
}

function spFindAreaById(id) {
  const areas = Array.isArray(spAreasConfig.areas) ? spAreasConfig.areas : [];
  const wanted = String(id || "all");
  return areas.find(a => String(a.id) === wanted) || areas.find(a => String(a.id) === "all") || null;
}

// Returnér postnr fra SharePoint fields (helst Postnr), fallback: parse 4 cifre fra AddressText
function spExtractPostnrFromFields(f) {
  const direct = (f && (f.Postnr ?? f.postnr ?? f.PostNr)) != null ? String(f.Postnr ?? f.postnr ?? f.PostNr) : "";
  const directTrim = direct.trim();
  if (/^\d{4}$/.test(directTrim)) return directTrim;

  const addr = (f && (f.AddressText ?? f.addressText)) != null ? String(f.AddressText ?? f.addressText) : "";
  const m = addr.match(/\b(\d{4})\b/);
  return m ? m[1] : "";
}

// match postnr mod "4700" eller "4000-4999"
function spPostnrMatchesRule(postnr, rule) {
  const p = String(postnr || "").trim();
  if (!/^\d{4}$/.test(p)) return false;

  const r = String(rule || "").trim();
  if (!r) return false;

  // interval "4000-4999"
  const im = r.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (im) {
    const a = parseInt(im[1], 10);
    const b = parseInt(im[2], 10);
    const n = parseInt(p, 10);
    return n >= Math.min(a, b) && n <= Math.max(a, b);
  }

  // enkelt postnr "4700"
  return r === p;
}

function spIsPostnrInSelectedArea(postnr) {
  const areaId = spGetSelectedAreaId();
  if (areaId === "all") return true;

  const area = spFindAreaById(areaId);
  if (!area) return true;

  const rules = Array.isArray(area.postnrs) ? area.postnrs : [];
  if (!rules.length) return true; // tom => ingen filter

  return rules.some(rule => spPostnrMatchesRule(postnr, rule));
}

// ===============================
// Restore-highlight (gul) helpers
// ===============================
let spRestoredHighlightIds = new Set();

function spSetRestoredHighlightIds(ids) {
  spRestoredHighlightIds = new Set((ids || []).filter(Boolean).map(String));
}

// Gør en Leaflet default-marker "gul" via CSS filter på <img>-ikonet
function spApplyYellowHighlight(marker) {
  if (!marker) return;
  if (!marker._meta) marker._meta = {};
  marker._meta._restoredHighlight = true;

  function applyNow() {
    if (marker._icon) {
      marker._icon.style.filter = "hue-rotate(60deg) saturate(450%) brightness(1.05)";
      marker._icon.style.webkitFilter = marker._icon.style.filter;
    }
  }

  // Ikon kan være null lige efter creation
  if (marker._icon) {
    applyNow();
  } else {
    marker.once("add", applyNow);
    setTimeout(applyNow, 0);
  }
}

function spClearYellowHighlight(marker) {
  if (!marker) return;
  if (!marker._meta) marker._meta = {};

  marker._meta._restoredHighlight = false;

  // VIGTIGT: fjern også fra highlight-Set, ellers bliver den gul igen efter næste reload
  const id =
    marker._meta._spMarkerId ||
    marker._meta._spMarkerID ||
    marker._spMarkerId ||
    null;

  if (id && spRestoredHighlightIds && spRestoredHighlightIds.size) {
    spRestoredHighlightIds.delete(String(id));
  }

  if (marker._icon) {
    marker._icon.style.filter = "";
    marker._icon.style.webkitFilter = "";
  }
}

// Kald efter refresh/load: find markører via spMarkerIndex og highlight dem
function spApplyHighlightsAfterReload() {
  if (!spRestoredHighlightIds || spRestoredHighlightIds.size === 0) return;

  for (const id of spRestoredHighlightIds) {
    const entry = spMarkerIndex.get(id);
    if (entry && entry.marker) {
      spApplyYellowHighlight(entry.marker);
    }
  }
}

/**
 * Stabilt MarkerId baseret på workspace+mapId+lat/lon (afrundet)
 * decimals=5 => ca. 1m præcision
 */
function makeStableMarkerId(lat, lon, decimals = 5) {
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!isFinite(latNum) || !isFinite(lonNum)) return null;

  const latFixed = latNum.toFixed(decimals);
  const lonFixed = lonNum.toFixed(decimals);

  const ws = String(SP_WORKSPACE || "").trim();
  const mid = String(SP_MAP_ID || "").trim();

  return `sp_${ws}_${mid}_${latFixed}_${lonFixed}`;
}
// ===============================
// Save/Delete marker to SharePoint (via Worker) - COOKIE AUTH
// ===============================
async function saveSharePointMarker(payload) {
  const url =
    `/markers` +
    `?workspace=${encodeURIComponent(SP_WORKSPACE)}` +
    `&mapId=${encodeURIComponent(SP_MAP_ID)}`;

  const latVal = payload && typeof payload.Lat === "number" ? payload.Lat : Number(payload?.Lat);
  const lonVal = payload && typeof payload.Lon === "number" ? payload.Lon : Number(payload?.Lon);

  const stableId = makeStableMarkerId(latVal, lonVal, 5);

  // Title: forsøg at sende en pæn titel (så vi undgår sp_... i UI)
  const titleText =
    (payload && payload.Title != null && String(payload.Title).trim() !== "")
      ? String(payload.Title).trim()
      : "Markør";

  // VIGTIGT:
  // Når man gemmer en markør (ved adressevalg), skal den altid være synlig på kortet.
  // Derfor tvinger vi HiddenOnMap=false her, så en tidligere "skjult" tur kan gendannes.
  const body = {
    markerId: (payload && payload.markerId) ? String(payload.markerId) : (stableId || undefined),
    workspace: SP_WORKSPACE,
    mapId: SP_MAP_ID,
    lat: latVal,
    lon: lonVal,
    title: titleText,
    Title: titleText, // send begge for kompatibilitet
    addressText: payload && payload.AddressText != null ? String(payload.AddressText) : "",
    postnr: payload && payload.Postnr != null ? String(payload.Postnr) : (payload && payload.postnr != null ? String(payload.postnr) : ""),
    Postnr: payload && payload.Postnr != null ? String(payload.Postnr) : (payload && payload.postnr != null ? String(payload.postnr) : ""),
    note: payload && payload.Note != null ? String(payload.Note) : "",
    status: payload && payload.Status != null ? String(payload.Status) : "",
    yk: payload && payload.YK != null ? String(payload.YK) : "",
    hiddenOnMap: false,
    HiddenOnMap: false
  };

  const resp = await spFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  let data = null;
  try { data = await resp.json(); } catch (e) {}

  if (!resp.ok || (data && data.ok === false)) {
    console.error("Save SharePoint marker failed:", data);
    return { ok: false, data };
  }

  return data || { ok: true };
}
/**
 * Opdater felter på en eksisterende SharePoint-markør via worker.
 * Forventer at worker understøtter PATCH (eller PUT) på /markers/{markerId}.
 * Fallback: hvis PATCH fejler, prøver vi POST (upsert) med samme markerId.
 */
function attachSharePointMarkerBehaviors(marker) {
  if (!marker) return;
  if (marker._spBehaviorsAttached) return;
  marker._spBehaviorsAttached = true;

    marker.on("contextmenu", async function () {
          // Hvis den var "nyligt gendannet": fjern gul highlight ved første interaktion
    if (marker._meta && marker._meta._restoredHighlight) {
      spClearYellowHighlight(marker);
    }
    if (!isSharePointOverlayActive()) return;

    const ok = confirm("Skjul denne tur på kortet?");
if (!ok) return;

    try {
      const markerId =
        marker?._meta?._spMarkerId ||
        marker?._meta?._spMarkerID ||
        marker?._spMarkerId ||
        null;

      if (markerId) {
        // LØSNING A: brug DELETE endpointet i worker, så DeletedAt bliver sat der
        await deleteSharePointMarker(markerId);
      } else {
        console.warn("Kunne ikke soft-delete i SharePoint: marker mangler markerId (fjerner kun lokalt).");
      }
    } catch (e) {
      console.warn("DELETE (soft-delete) fejlede (fjerner fortsat lokalt):", e);
    }

    // Fjern lokalt
    if (sharePointMarkersLayer && sharePointMarkersLayer.hasLayer(marker)) {
      sharePointMarkersLayer.removeLayer(marker);
    } else if (map && map.hasLayer(marker)) {
      map.removeLayer(marker);
    }

    // Ryd selection hvis nødvendig
    if (currentMarker === marker) currentMarker = null;

    if (activeInfoMarker === marker) {
      document.getElementById("infoBox").style.display = "none";
      document.getElementById("statsvejInfoBox").style.display = "none";
      document.getElementById("kommuneOverlay").style.display = "none";
      resetCoordinateBox();
      setActiveInfoMarker(null);
    }
  });

  // Klik på SharePoint-markør skal opføre sig som ved ny adresse (billede 2):
  // - vise infoBox
  // - binde note-feltet til markøren
  // - reverse-geocode DK hvis vi ikke allerede har data
  marker.on("click", async function () {
        // Hvis den var "nyligt gendannet": fjern gul highlight ved første interaktion
    if (marker._meta && marker._meta._restoredHighlight) {
      spClearYellowHighlight(marker);
    }
    const latlng = marker.getLatLng();

    currentMarker = marker;
    setActiveInfoMarker(marker);

    if (marker._meta && marker._meta.dkReverseData) {
      await updateInfoBox(marker._meta.dkReverseData, latlng.lat, latlng.lng);
      const ta = document.getElementById("markerNote");
      if (ta && marker._meta) ta.value = marker._meta.note || "";
      return;
    }

    if (marker._meta && marker._meta.foreignFeature) {
      updateInfoBoxForeign(marker._meta.foreignFeature, latlng.lat, latlng.lng);
      const ta = document.getElementById("markerNote");
      if (ta && marker._meta) ta.value = marker._meta.note || "";
      return;
    }

    try {
      const lat = latlng.lat;
      const lon = latlng.lng;

      if (isInDenmarkByPolygon(lat, lon)) {
        const revUrl = `https://api.dataforsyningen.dk/adgangsadresser/reverse?x=${lon}&y=${lat}&struktur=flad`;
        const r = await fetch(revUrl);
        const data = await r.json();

        await updateInfoBox(data, lat, lon);

        const ta = document.getElementById("markerNote");
        if (ta && marker._meta) ta.value = marker._meta.note || "";
      } else {
        const feat = await reverseGeocodeORS(lat, lon);
        if (feat) {
          if (!marker._meta) marker._meta = {};
          marker._meta.foreignFeature = feat;
          updateInfoBoxForeign(feat, lat, lon);

          const ta = document.getElementById("markerNote");
          if (ta && marker._meta) ta.value = marker._meta.note || "";
        }
      }
    } catch (e) {
      console.warn("Kunne ikke reverse-geocode ved klik på SharePoint-markør:", e);
      const infoBox = document.getElementById("infoBox");
      if (infoBox) infoBox.style.display = "block";
    }
  });
}
/**
 * Debounced note-update til SharePoint for en given marker.
 * Lægger timer på marker._meta så hver markør har sin egen debounce.
 */
function queueSharePointNoteUpdate(marker, newNote) {
  if (!isSharePointOverlayActive()) return;
  if (!marker) return;
  
  if (!marker._meta) marker._meta = {};
  const markerId =
    marker._meta._spMarkerId ||
    marker._meta._spMarkerID ||
    marker._spMarkerId ||
    null;

  if (!markerId) return;

  const noteStr = (newNote != null ? String(newNote) : "");
  if (marker._meta._lastSentNote === noteStr) return;

  // Debounce pr. marker
  if (marker._meta._spNoteSaveTimer) {
    clearTimeout(marker._meta._spNoteSaveTimer);
  }

  marker._meta._spNoteSaveTimer = setTimeout(async function () {
    try {
      marker._meta._lastSentNote = noteStr;

      // Tag adressetekst med hvis worker kræver det (harmløst ellers)
      const ll = marker.getLatLng();
      const addressText = marker._meta.addressText || "";

      await updateSharePointMarker(markerId, {
        note: noteStr,
        lat: ll.lat,
        lon: ll.lng,
        addressText: addressText
      });
    } catch (e) {
      console.warn("SharePoint note-update fejlede:", e);
    }
  }, 600);
}
/**
 * Opdater felter på en eksisterende SharePoint-markør via worker.
 * Vi bruger PATCH /markers/{markerId}
 */
async function updateSharePointMarker(markerId, patch) {
  const url =
    `/markers/${encodeURIComponent(String(markerId))}` +
    `?workspace=${encodeURIComponent(SP_WORKSPACE)}` +
    `&mapId=${encodeURIComponent(SP_MAP_ID)}`;

  const body = Object.assign({}, patch || {});

  // Sørg for at hiddenOnMap sendes som bool (worker normaliserer også)
  if (typeof body.hiddenOnMap !== "undefined") {
    body.hiddenOnMap = !!body.hiddenOnMap;
    body.HiddenOnMap = !!body.hiddenOnMap; // send begge for kompat
  }
  if (typeof body.note !== "undefined") {
    body.note = body.note != null ? String(body.note) : "";
    body.Note = body.note;
  }
  if (typeof body.addressText !== "undefined") {
    body.addressText = body.addressText != null ? String(body.addressText) : "";
    body.AddressText = body.addressText;
  }

  const resp = await spFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  let data = null;
  try { data = await resp.json(); } catch (e) {}

  if (!resp.ok || (data && data.ok === false)) {
    console.error("Update SharePoint marker failed:", data);
    throw new Error("Update SharePoint marker failed");
  }

  return data || { ok: true };
}

async function deleteSharePointMarker(markerId) {
  const url =
    `/markers/${encodeURIComponent(String(markerId))}` +
    `?workspace=${encodeURIComponent(SP_WORKSPACE)}` +
    `&mapId=${encodeURIComponent(SP_MAP_ID)}`;

  const resp = await spFetch(url, {
    method: "DELETE"
  });

  let data = null;
  try { data = await resp.json(); } catch (e) {}

  if (!resp.ok || (data && data.ok === false)) {
    console.error("Delete SharePoint marker failed:", data);
    throw new Error("Delete SharePoint marker failed");
  }
  return data || { ok: true };
}

// ===============================
// Load markers from SharePoint (via Worker) - COOKIE AUTH
// ===============================

async function loadSharePointMarkers() {
  try {
    const response = await spFetch(
      `/markers?workspace=${encodeURIComponent(SP_WORKSPACE)}&mapId=${encodeURIComponent(SP_MAP_ID)}`,
      { method: "GET" }
    );

    const data = await response.json();

    sharePointMarkersLayer.clearLayers();

    if (!data.ok) {
      console.error("Worker error:", data);
      return;
    }

    console.log("Loaded markers:", data);

    (data.items || []).forEach(item => {
      const f = item.fields || {};
        // Område-filter (kun relevant når SP overlay er aktivt)
  const postnr = spExtractPostnrFromFields(f);
  if (!spIsPostnrInSelectedArea(postnr)) return;
      console.log("[SP load] item fields keys:", Object.keys(f));
console.log("[SP load] MarkerId:", f.MarkerId || f.markerId, "HiddenOnMap:", f.HiddenOnMap, "hiddenOnMap:", f.hiddenOnMap);


      // SKIP: skjulte ture (soft delete)
            const hiddenStrA = String(f.HiddenOnMap ?? "").toLowerCase().trim();
      const hiddenStrB = String(f.hiddenOnMap ?? "").toLowerCase().trim();
      const hiddenStrC = String(f.hiddenonmap ?? "").toLowerCase().trim();

      const hidden =
        (f.HiddenOnMap === true) ||
        (f.hiddenOnMap === true) ||
        (hiddenStrA === "true" || hiddenStrA === "1" || hiddenStrA === "yes") ||
        (hiddenStrB === "true" || hiddenStrB === "1" || hiddenStrB === "yes") ||
        (hiddenStrC === "true" || hiddenStrC === "1" || hiddenStrC === "yes") ||
        (f.HiddenOnMap === 1);

            if (hidden) return;

      // Område-filter baseret på SharePoint-feltet Postnr
      const postnrVal = (typeof f.Postnr === "number") ? f.Postnr : parseFloat(f.Postnr);
      if (!spAreaAllowsPostnr(postnrVal)) return;

      const lat = typeof f.Lat === "number" ? f.Lat : parseFloat(f.Lat);
      const lon = typeof f.Lon === "number" ? f.Lon : parseFloat(f.Lon);

      if (!isFinite(lat) || !isFinite(lon)) return;

      const marker = L.marker([lat, lon]);
      sharePointMarkersLayer.addLayer(marker);

      if (!marker._meta) marker._meta = {};
      marker._meta._spMarkerId = f.MarkerId || f.markerId || null;
      marker._meta._spItemId = item.id || item.itemId || null;
      marker._meta.note = f.Note != null ? String(f.Note) : "";

      if (f.AddressText) {
        setMarkerHoverAddress(marker, String(f.AddressText));
      }

      if (marker._meta._spMarkerId) {
        spMarkerIndex.set(marker._meta._spMarkerId, {
          marker: marker,
          itemId: marker._meta._spItemId
        });
      }

      attachSharePointMarkerBehaviors(marker);

            // Popup: vis kun adresse + note (ingen Title)
      const addr = f.AddressText != null ? String(f.AddressText) : "";
      const note = f.Note != null ? String(f.Note) : "";

      marker.bindPopup(`
        ${addr ? `<strong>${addr}</strong><br>` : ""}
        ${note ? `${note}` : ""}
      `);
    });

    // Efter load: apply gul highlight på evt. gendannede markører
    spApplyHighlightsAfterReload();
    
  } catch (err) {
    console.error("Load markers failed:", err);
  }
}
