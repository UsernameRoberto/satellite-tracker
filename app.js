window.addEventListener("load", () => {
  document.getElementById("map").classList.add("fade-in");
});

let unit = localStorage.getItem("speedUnit") || "kmh";
let currentTheme = localStorage.getItem("theme") || "light";
let selectedSatelliteId = "iss";

// Initialize map at zoom 2 for animation start
const map = L.map("map").setView([0, 0], 2);

// Smooth zoom in on map load to zoom 3
map.whenReady(() => {
  map.flyTo([0, 0], 3, {
    animate: true,
    duration: 2 // seconds for zoom animation
  });

  // Also set icon scaling after zoom completes
  setTimeout(() => {
    const zoom = map.getZoom();
    Object.entries(markers).forEach(([id, marker]) => {
      const newIcon = scaleIcon(id, zoom);
      marker.setIcon(newIcon);
    });
  }, 2100);
});

const kmhBtn = document.getElementById("kmhBtn");
const mphBtn = document.getElementById("mphBtn");
const themeToggle = document.getElementById("themeToggle");
const telemetryData = document.getElementById("telemetry-data");
const satelliteDropdown = document.getElementById("satelliteDropdown");

let tleData = {};
let markers = {};
let trails = {};
let trailLength = 30;
let updateInterval = 1000;
let themeLayer;

// 🛰 Custom satellite icons
const satelliteIcons = {
  iss: L.icon({
    iconUrl: 'icons/iss.png',
    iconSize: [200, 110],
    iconAnchor: [150, 55],
    tooltipAnchor: [0, -20]
  }),
  starlink: L.icon({
    iconUrl: 'icons/starlink.png',
    iconSize: [113, 113],
    iconAnchor: [56.5, 56.5],
    tooltipAnchor: [0, -15]
  })
};

// 🌍 Map Layers
const lightLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community'
  }
);
applyTheme();

function applyTheme() {
  if (themeLayer) map.removeLayer(themeLayer);

  switch (currentTheme) {
    case "dark":
      themeLayer = darkLayer;
      break;
    case "satellite":
      themeLayer = satelliteLayer;
      break;
    default:
      themeLayer = lightLayer;
  }

  map.addLayer(themeLayer);
  document.body.className = currentTheme === "dark" ? "dark" : "light";
}

themeToggle.addEventListener("click", () => {
  if (currentTheme === "light") currentTheme = "dark";
  else if (currentTheme === "dark") currentTheme = "satellite";
  else currentTheme = "light";

  localStorage.setItem("theme", currentTheme);
  applyTheme();
});

async function loadTLEData() {
  try {
    const [issText, starlinkText] = await Promise.all([
      fetch("iss.txt").then(res => {
        if (!res.ok) throw new Error("Failed to fetch iss.txt");
        return res.text();
      }),
      fetch("starlink.txt").then(res => {
        if (!res.ok) throw new Error("Failed to fetch starlink.txt");
        return res.text();
      })
    ]);

    const issLines = issText.trim().split("\n");
    if (issLines.length < 3) {
      console.error("Invalid ISS TLE data");
      return;
    }
    tleData["iss"] = {
      name: "ISS (ZARYA)",
      tle: [issLines[1], issLines[2]]
    };

    const lines = starlinkText.trim().split("\n");
    for (let i = 0; i < lines.length - 2; i += 3) {
      const name = lines[i].trim();
      const tle1 = lines[i + 1]?.trim();
      const tle2 = lines[i + 2]?.trim();

      if (name && tle1 && tle2) {
        const id = `starlink-${i / 3}`;
        tleData[id] = {
          name,
          tle: [tle1, tle2]
        };
      } else {
        console.warn(`Skipping malformed Starlink TLE at index ${i}`);
      }
    }

    populateDropdown();
  } catch (err) {
    console.error("Error loading TLE data:", err);
  }
}

function populateDropdown() {
  Object.entries(tleData).forEach(([id, sat]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = sat.name;
    satelliteDropdown.appendChild(option);
  });
}

satelliteDropdown.addEventListener("change", (e) => {
  selectedSatelliteId = e.target.value;
  updateTelemetry();
});

function getLatLonAlt(tle) {
  const satrec = satellite.twoline2satrec(tle[0], tle[1]);
  const positionAndVelocity = satellite.propagate(satrec, new Date());
  const gmst = satellite.gstime(new Date());
  const positionGd = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
  const lat = satellite.degreesLat(positionGd.latitude);
  const lon = satellite.degreesLong(positionGd.longitude);
  const alt = positionGd.height * 1000;
  const velocity = Math.sqrt(
    positionAndVelocity.velocity.x ** 2 +
    positionAndVelocity.velocity.y ** 2 +
    positionAndVelocity.velocity.z ** 2
  ) * 3600;

  return { lat, lon, alt, velocity };
}

// ✅ Create marker with custom icon
// Remove this line inside createMarker:
// marker.bindTooltip(name, { permanent: true, ... });

// Instead add this after marker creation:

function createMarker(id, name, lat, lon) {
  // Pick icon
  const icon = id === "iss" ? satelliteIcons.iss : satelliteIcons.starlink;

  // Create marker with icon
  const marker = L.marker([lat, lon], { icon: icon }).addTo(map);

  // Save marker to global markers object
  markers[id] = marker;

  // Create trail polyline if it doesn't exist
  if (!trails[id]) {
    trails[id] = L.polyline([[lat, lon]], { color: 'yellow' }).addTo(map);
  }

  // Add click event on marker
  marker.on("click", (e) => {
    if (floatingTooltip.style.opacity === "1" && floatingTooltip.dataset.id === id) {
      hideFloatingTooltip();
    } else {
      showFloatingTooltip(id, name, e);
    }
    selectedSatelliteId = id;
    updateTelemetry(); // Update telemetry panel on click
    map.setView([e.latlng.lat, e.latlng.lng], map.getZoom());
    document.querySelector(".panel").style.display = "block";
  });
}



function updateTelemetry() {
  Object.entries(tleData).forEach(([id, sat]) => {
    const { lat, lon, alt, velocity } = getLatLonAlt(sat.tle);

    if (isNaN(lat) || isNaN(lon)) return;

    if (!markers[id]) {
      createMarker(id, sat.name, lat, lon);
    } else {
      markers[id].setLatLng([lat, lon]);
    }

    const trail = trails[id];
    if (trail) {
      const latlngs = trail.getLatLngs();
      latlngs.push([lat, lon]);
      if (latlngs.length > trailLength) latlngs.shift();
      trail.setLatLngs(latlngs);
    }

    if (id === selectedSatelliteId) {
      map.setView([lat, lon]);

      const speed = unit === "kmh" ? velocity : velocity / 1.609;
      telemetryData.innerHTML = `
        Lat: ${lat.toFixed(2)}<br>
        Lon: ${lon.toFixed(2)}<br>
        Alt: ${(alt / 1000).toFixed(2)} km<br>
        Vel: ${speed.toFixed(2)} ${unit === "kmh" ? "Km/h" : "Mph"}
      `;
    }
  });
}

kmhBtn.addEventListener("click", () => {
  unit = "kmh";
  localStorage.setItem("speedUnit", unit);
});
mphBtn.addEventListener("click", () => {
  unit = "mph";
  localStorage.setItem("speedUnit", unit);
});

loadTLEData().then(() => {
  setInterval(updateTelemetry, updateInterval);
});

// Base icon sizes (for zoom level 2)
const baseIconSizes = {
  iss: { width: 200, height: 110, anchorX: 150, anchorY: 55, tooltipYOffset: 20 },
  starlink: { width: 113, height: 113, anchorX: 56.5, anchorY: 56.5, tooltipYOffset: 15 },
};

// Minimum and maximum icon scales
const minScale = 0.5;
const maxScale = 2;

function scaleIcon(id, zoom) {
  const base = baseIconSizes[id === "iss" ? "iss" : "starlink"];
  // Scale factor: zoom 2 = 1x, zoom 5 = ~1.5x, zoom 8+ = 2x (clamped)
  const scale = Math.min(maxScale, Math.max(minScale, 1 + (zoom - 2) * 0.2));
  const newWidth = base.width * scale;
  const newHeight = base.height * scale;
  const newAnchorX = base.anchorX * scale;
  const newAnchorY = base.anchorY * scale;
  const newTooltipYOffset = -base.tooltipYOffset * scale;

  return L.icon({
    iconUrl: id === "iss" ? 'icons/iss.png' : 'icons/starlink.png',
    iconSize: [newWidth, newHeight],
    iconAnchor: [newAnchorX, newAnchorY],
    tooltipAnchor: [0, newTooltipYOffset],
  });
}

map.on("zoomend", () => {
  const zoom = map.getZoom();
  Object.entries(markers).forEach(([id, marker]) => {
    const newIcon = scaleIcon(id, zoom);
    marker.setIcon(newIcon);
  });
});

// Call once at start to set correct icon size for initial zoom
map.whenReady(() => {
  const zoom = map.getZoom();
  Object.entries(markers).forEach(([id, marker]) => {
    const newIcon = scaleIcon(id, zoom);
    marker.setIcon(newIcon);
  });
});

const floatingTooltip = document.getElementById("floatingTooltip");

function showFloatingTooltip(id, name, event) {
  floatingTooltip.textContent = name;
  floatingTooltip.dataset.id = id;
  // Convert latlng to container point (pixels)
  const point = map.latLngToContainerPoint(event.latlng);
  // Position the tooltip slightly above and centered horizontally
  floatingTooltip.style.left = (point.x - floatingTooltip.offsetWidth / 2) + "px";
  floatingTooltip.style.top = (point.y - 40) + "px"; // 40px above marker
  floatingTooltip.style.opacity = "1";
}

function hideFloatingTooltip() {
  floatingTooltip.style.opacity = "0";
  floatingTooltip.dataset.id = "";
}

// Hide tooltip when clicking on map but not marker
map.on("click", () => {
  hideFloatingTooltip();
});

const fullscreenToggle = document.getElementById("fullscreenToggle");
const fullscreenIcon = fullscreenToggle.querySelector("i");

fullscreenToggle.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.getElementById("map").requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

// Listen for fullscreen changes to update icon
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) {
    fullscreenIcon.classList.remove("fa-eye");
    fullscreenIcon.classList.add("fa-eye-slash");
  } else {
    fullscreenIcon.classList.remove("fa-eye-slash");
    fullscreenIcon.classList.add("fa-eye");
  }

  // Force Leaflet to recalc map size after fullscreen toggling
  setTimeout(() => {
    map.invalidateSize();
  }, 200);
});

