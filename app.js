const prayerNames = [
  ["Fajr", "الفجر"],
  ["Dhuhr", "الظهر"],
  ["Asr", "العصر"],
  ["Maghrib", "المغرب"],
  ["Isha", "العشاء"],
];

const map = L.map("map", { scrollWheelZoom: false }).setView([24.7136, 46.6753], 3);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const searchForm = document.querySelector("#search-form");
const cityInput = document.querySelector("#city-input");
const locateButton = document.querySelector("#locate-button");
const methodSelect = document.querySelector("#method-select");
const statusMessage = document.querySelector("#status");
const timesTitle = document.querySelector("#times-title");
const dateLabel = document.querySelector("#date-label");
const prayerList = document.querySelector("#prayer-list");

let locationMarker;
let currentLocation;
let requestId = 0;
let lastGeocodingRequest = 0;
let geocodingQueue = Promise.resolve();

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.dataset.error = String(isError);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`تعذر إكمال الطلب (${response.status}).`);
  }
  return response.json();
}

function geocode(path) {
  const request = geocodingQueue.then(async () => {
    const elapsed = Date.now() - lastGeocodingRequest;
    if (elapsed < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
    }
    lastGeocodingRequest = Date.now();
    return fetchJson(`https://nominatim.openstreetmap.org${path}`);
  });
  geocodingQueue = request.catch(() => {});
  return request;
}

function shortPlaceName(displayName) {
  return displayName.split(",").slice(0, 2).join(",").trim();
}

async function showLocation({ latitude, longitude, name }) {
  const thisRequest = ++requestId;
  currentLocation = { latitude, longitude, name };
  timesTitle.textContent = name;
  setStatus("جارٍ تحميل مواقيت الصلاة...");

  if (locationMarker) {
    locationMarker.setLatLng([latitude, longitude]);
  } else {
    locationMarker = L.marker([latitude, longitude]).addTo(map);
  }
  map.setView([latitude, longitude], 11);

  const method = encodeURIComponent(methodSelect.value);
  const url = `https://api.aladhan.com/v1/timings?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&method=${method}`;

  try {
    const result = await fetchJson(url);
    if (thisRequest !== requestId) return;
    if (result.code !== 200 || !result.data?.timings) {
      throw new Error("لم تصل مواقيت صالحة لهذا الموقع.");
    }

    const { timings, date } = result.data;
    prayerList.replaceChildren();
    for (const [key, label] of prayerNames) {
      const row = document.createElement("div");
      row.className = "prayer-row";
      const nameElement = document.createElement("span");
      nameElement.textContent = label;
      const timeElement = document.createElement("time");
      timeElement.textContent = timings[key]?.split(" ")[0] ?? "—";
      row.append(nameElement, timeElement);
      prayerList.append(row);
    }

    dateLabel.textContent = date?.readable ?? "";
    setStatus(`الموقع: ${name}`);
  } catch (error) {
    if (thisRequest !== requestId) return;
    setStatus(error.message || "تعذر تحميل مواقيت الصلاة. حاول مرة أخرى.", true);
  }
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = cityInput.value.trim();
  if (!query) return;
  setStatus("جارٍ البحث عن الموقع...");
  try {
    const results = await geocode(`/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`);
    if (!results.length) {
      setStatus("لم نعثر على هذا المكان. جرّب اسم مدينة أو مكان أوضح.", true);
      return;
    }
    const place = results[0];
    await showLocation({
      latitude: Number(place.lat),
      longitude: Number(place.lon),
      name: shortPlaceName(place.display_name),
    });
  } catch (error) {
    setStatus(error.message || "تعذر البحث عن الموقع.", true);
  }
});

locateButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("المتصفح لا يدعم تحديد الموقع. ابحث عن مدينتك بدلًا من ذلك.", true);
    return;
  }

  setStatus("بانتظار إذن تحديد الموقع...");
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      try {
        const results = await geocode(
          `/reverse?format=jsonv2&lat=${encodeURIComponent(coords.latitude)}&lon=${encodeURIComponent(coords.longitude)}`,
        );
        await showLocation({
          latitude: coords.latitude,
          longitude: coords.longitude,
          name: results.name || shortPlaceName(results.display_name || "موقعي الحالي"),
        });
      } catch (error) {
        setStatus(error.message || "تعذر تحديد اسم الموقع.", true);
      }
    },
    (error) => {
      const message =
        error.code === error.PERMISSION_DENIED
          ? "لم يُسمح بالوصول إلى الموقع. يمكنك البحث عن مدينتك يدويًا."
          : "تعذر تحديد موقعك. تحقق من إعدادات الموقع أو ابحث عن مدينتك.";
      setStatus(message, true);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
});

methodSelect.addEventListener("change", () => {
  if (currentLocation) showLocation(currentLocation);
});
