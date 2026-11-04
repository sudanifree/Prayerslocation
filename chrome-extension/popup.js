const prayerNames = [
  ["Fajr", "الفجر"],
  ["Dhuhr", "الظهر"],
  ["Asr", "العصر"],
  ["Maghrib", "المغرب"],
  ["Isha", "العشاء"],
];

const searchForm = document.querySelector("#search-form");
const cityInput = document.querySelector("#city-input");
const locateButton = document.querySelector("#locate-button");
const methodSelect = document.querySelector("#method-select");
const statusMessage = document.querySelector("#status");
const placeName = document.querySelector("#place-name");
const dateLabel = document.querySelector("#date-label");
const prayerList = document.querySelector("#prayer-list");

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

async function showLocation(location) {
  const thisRequest = ++requestId;
  currentLocation = location;
  placeName.textContent = location.name;
  cityInput.value = location.name;
  setStatus("جارٍ تحميل مواقيت الصلاة...");

  try {
    await chrome.storage.local.set({ location });
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      method: methodSelect.value,
    });
    const result = await fetchJson(`https://api.aladhan.com/v1/timings?${params}`);
    if (thisRequest !== requestId) return;
    if (result.code !== 200 || !result.data?.timings) {
      throw new Error("لم تصل مواقيت صالحة لهذا الموقع.");
    }

    prayerList.replaceChildren();
    for (const [key, label] of prayerNames) {
      const row = document.createElement("div");
      row.className = "prayer-row";
      const nameElement = document.createElement("span");
      nameElement.textContent = label;
      const timeElement = document.createElement("time");
      timeElement.textContent = result.data.timings[key]?.split(" ")[0] ?? "—";
      row.append(nameElement, timeElement);
      prayerList.append(row);
    }

    dateLabel.textContent = result.data.date?.readable ?? "";
    setStatus(`الموقع: ${location.name}`);
  } catch (error) {
    if (thisRequest !== requestId) return;
    setStatus(error.message || "تعذر تحميل مواقيت الصلاة.", true);
  }
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = cityInput.value.trim();
  if (!query) return;
  setStatus("جارٍ البحث عن الموقع...");
  try {
    const results = await geocode(
      `/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
    );
    if (!results.length) {
      setStatus("لم نعثر على هذا المكان. جرّب اسمًا أوضح.", true);
      return;
    }
    const result = results[0];
    await showLocation({
      latitude: Number(result.lat),
      longitude: Number(result.lon),
      name: shortPlaceName(result.display_name),
    });
  } catch (error) {
    setStatus(error.message || "تعذر البحث عن الموقع.", true);
  }
});

locateButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("تعذر تحديد الموقع من هذا المتصفح. ابحث عن مدينتك.", true);
    return;
  }

  setStatus("بانتظار إذن تحديد الموقع...");
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      try {
        const result = await geocode(
          `/reverse?format=jsonv2&lat=${encodeURIComponent(coords.latitude)}&lon=${encodeURIComponent(coords.longitude)}`,
        );
        await showLocation({
          latitude: coords.latitude,
          longitude: coords.longitude,
          name: result.name || shortPlaceName(result.display_name || "موقعي الحالي"),
        });
      } catch (error) {
        setStatus(error.message || "تعذر تحديد اسم الموقع.", true);
      }
    },
    (error) => {
      const message =
        error.code === error.PERMISSION_DENIED
          ? "لم يُسمح بالوصول إلى الموقع. يمكنك البحث عن مدينتك."
          : "تعذر تحديد موقعك. تحقق من إعدادات الموقع أو ابحث عن مدينتك.";
      setStatus(message, true);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
});

methodSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ method: methodSelect.value });
  if (currentLocation) showLocation(currentLocation);
});

async function initialize() {
  const saved = await chrome.storage.local.get(["location", "method"]);
  if (saved.method) methodSelect.value = saved.method;
  if (saved.location) {
    await showLocation(saved.location);
  }
}

initialize().catch((error) => {
  setStatus(error.message || "تعذر تحميل الإعدادات المحفوظة.", true);
});
