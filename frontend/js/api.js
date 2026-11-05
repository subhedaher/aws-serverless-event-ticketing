// Small wrapper around fetch for calling our API Gateway.
async function apiFetch(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (auth) {
    const token = await Auth.getToken();
    if (!token) {
      // Keep the query string too, so event.html?id=... returns to the same event after login
      const next = encodeURIComponent((location.pathname.split("/").pop() || "index.html") + location.search);
      location.href = `login.html?next=${next}`;
      throw new Error("Please log in first");
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(APP_CONFIG.API_URL + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

// Shows a message in the element with id="message".
function showMessage(text, type = "info") {
  const box = document.getElementById("message");
  if (!box) return alert(text);
  box.textContent = text;
  box.className = `message ${type}`;
  box.hidden = false;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("ar-EG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
