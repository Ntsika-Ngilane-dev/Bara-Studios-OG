const loginView = document.querySelector("#login-view");
const adminShell = document.querySelector("#admin-shell");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const globalMessage = document.querySelector("#global-message");
const state = {
  csrfToken: "",
  currency: "ZAR",
  summary: {},
  clients: [],
  services: [],
  products: [],
  sales: [],
  suppliers: [],
  supplyOrders: [],
  inquiries: [],
  notifications: [],
  settings: { channels: {} },
  activeClient: null,
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatMoney(minorUnits) {
  const amount = Number(minorUnits || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: state.currency }).format(amount);
  } catch {
    return `${state.currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(value, options = { dateStyle: "medium" }) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, options).format(date);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.querySelector("#toast-region").append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function setGlobalMessage(message) {
  globalMessage.textContent = message;
  globalMessage.classList.add("is-visible");
  window.clearTimeout(setGlobalMessage.timeoutId);
  setGlobalMessage.timeoutId = window.setTimeout(() => globalMessage.classList.remove("is-visible"), 3600);
}

async function api(url, options = {}) {
  const method = options.method || "GET";
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD"].includes(method) && state.csrfToken) headers.set("X-CSRF-Token", state.csrfToken);

  const response = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  let result = {};
  try {
    result = await response.json();
  } catch {
    if (response.ok) throw new Error("The server returned an unreadable response.");
  }
  if (response.status === 401 && !url.startsWith("/api/auth/")) {
    state.csrfToken = "";
    showLogin("Your admin session ended. Please sign in again.");
  }
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

function showLogin(message = "") {
  loginView.hidden = false;
  adminShell.hidden = true;
  loginMessage.textContent = message;
}

function showDashboard(email) {
  loginView.hidden = true;
  adminShell.hidden = false;
  document.querySelector("#account-email").textContent = email;
}

async function loadDashboard() {
  const [
    summary,
    clients,
    services,
    products,
    sales,
    suppliers,
    supplyOrders,
    inquiries,
    notifications,
    settings,
  ] = await Promise.all([
    api("/api/admin/summary"),
    api("/api/admin/clients"),
    api("/api/admin/services"),
    api("/api/admin/products"),
    api("/api/admin/sales"),
    api("/api/admin/suppliers"),
    api("/api/admin/supply-orders"),
    api("/api/admin/inquiries"),
    api("/api/admin/notifications"),
    api("/api/admin/settings"),
  ]);
  state.summary = summary;
  state.clients = clients;
  state.services = services;
  state.products = products;
  state.sales = sales;
  state.suppliers = suppliers;
  state.supplyOrders = supplyOrders;
  state.inquiries = inquiries;
  state.notifications = notifications;
  state.settings = settings;
  state.currency = settings.currency || "ZAR";
  renderAll();
}

function renderAll() {
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date());
  renderOverview();
  renderClients();
  renderStore();
  renderSuppliers();
  renderSupplyOrders();
  renderInquiries();
  renderNotifications();
  renderChannelStatus();
  document.querySelector("#currency-code").value = state.currency;
}

function renderOverview() {
  const summary = state.summary;
  const metrics = [
    ["Active clients", summary.client_count, "Client accounts"],
    ["Active services", summary.active_service_count, "Across client accounts"],
    ["Open enquiries", summary.open_inquiry_count, `${summary.priority_inquiry_count || 0} marked high priority`],
    ["Revenue this month", formatMoney(summary.month_revenue_cents), `${summary.paid_sale_count || 0} paid sales recorded`],
  ];
  document.querySelector("#overview-metrics").innerHTML = metrics.map(([label, value, note]) => `
    <article class="metric-card"><p>${escapeHtml(label)}</p><strong>${escapeHtml(value ?? 0)}</strong><small>${escapeHtml(note)}</small></article>
  `).join("");

  const trend = summary.revenue_trend || [];
  const maxRevenue = Math.max(...trend.map((item) => Number(item.revenue_cents || 0)), 1);
  document.querySelector("#revenue-chart").innerHTML = trend.map((item) => {
    const height = Math.max(3, Math.round((Number(item.revenue_cents || 0) / maxRevenue) * 100));
    return `<div class="chart-column" title="${escapeHtml(item.label)}: ${escapeHtml(formatMoney(item.revenue_cents))}">
      <span class="chart-value">${escapeHtml(formatMoney(item.revenue_cents))}</span>
      <div class="chart-bar-wrap"><span class="chart-bar" style="height:${height}%"></span></div>
      <span class="chart-month">${escapeHtml(item.label)}</span>
    </div>`;
  }).join("");

  const recent = summary.recent_inquiries || [];
  document.querySelector("#recent-enquiries").innerHTML = recent.map((inquiry) => `
    <div class="list-row">
      <div class="list-main"><strong>${escapeHtml(inquiry.name)}</strong><small>${escapeHtml(inquiry.service || "General enquiry")} · ${escapeHtml(formatDate(inquiry.created_at))}</small></div>
      <span class="status-pill status-${escapeHtml(inquiry.priority)}">${escapeHtml(inquiry.priority)}</span>
    </div>`).join("");
  document.querySelector("#recent-enquiries").hidden = recent.length === 0;
  if (!recent.length) document.querySelector("#recent-enquiries").innerHTML = '<p class="empty-state">New enquiries will appear here.</p>';

  const products = summary.top_products || [];
  document.querySelector("#top-products").innerHTML = products.map((product) => `
    <div class="list-row"><div class="list-main"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.units)} sold</small></div><strong>${escapeHtml(formatMoney(product.revenue_cents))}</strong></div>
  `).join("");
  if (!products.length) document.querySelector("#top-products").innerHTML = '<p class="empty-state">Record a sale to see product analytics.</p>';

  setCount("#enquiry-count", summary.open_inquiry_count);
  setCount("#alert-count", summary.unread_notification_count);
}

function setCount(selector, count) {
  const element = document.querySelector(selector);
  element.textContent = String(count || 0);
  element.hidden = Number(count || 0) === 0;
}

function renderClients() {
  const table = document.querySelector("#clients-table");
  table.innerHTML = state.clients.map((client) => `
    <tr>
      <td class="table-primary"><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.company || "Independent client")}</small></td>
      <td>${escapeHtml(client.email || "—")}<br><small>${escapeHtml(client.phone || "")}</small></td>
      <td>${escapeHtml(client.active_service_count)}</td>
      <td>${escapeHtml(formatMoney(client.revenue_cents))}</td>
      <td>${escapeHtml(formatDate(client.last_inquiry_at))}</td>
      <td><span class="status-pill status-${escapeHtml(client.status)}">${escapeHtml(client.status)}</span></td>
      <td><button class="table-action" type="button" data-client-detail="${client.id}">Open</button></td>
    </tr>`).join("");
  document.querySelector("#clients-empty").hidden = state.clients.length > 0;

  const select = document.querySelector("#sale-client");
  select.innerHTML = '<option value="">Unlinked sale</option>' + state.clients
    .filter((client) => client.status !== "archived")
    .map((client) => `<option value="${client.id}">${escapeHtml(client.name)}${client.company ? ` · ${escapeHtml(client.company)}` : ""}</option>`)
    .join("");
  syncUnlinkedSaleFields();
}

function syncUnlinkedSaleFields() {
  const linkedClient = Boolean(document.querySelector("#sale-client").value);
  document.querySelector('#sale-form [name="customer_name"]').required = !linkedClient;
}

async function openClient(id) {
  const client = await api(`/api/admin/clients/${id}`);
  state.activeClient = client;
  const serviceOptions = state.services.filter((service) => service.active).map((service) => `
    <option value="${service.id}">${escapeHtml(service.name)}</option>`).join("");
  const serviceRows = client.services.length
    ? client.services.map((service) => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.started_on || "Start date not set")} · ${escapeHtml(service.notes || "")}</small></div><span class="status-pill status-${escapeHtml(service.status)}">${escapeHtml(formatMoney(service.price_cents))} / ${escapeHtml(service.status)}</span></div>`).join("")
    : '<p class="empty-state">No services assigned to this client yet.</p>';
  const salesRows = client.sales.length
    ? client.sales.map((sale) => `<div class="list-row"><div class="list-main"><strong>Sale #${sale.id}</strong><small>${escapeHtml(formatDate(sale.created_at))}</small></div><span>${escapeHtml(formatMoney(sale.total_cents))}</span></div>`).join("")
    : '<p class="empty-state">No linked sales yet.</p>';
  const inquiryRows = client.inquiries.length
    ? client.inquiries.map((inquiry) => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(inquiry.service || "General enquiry")}</strong><small>${escapeHtml(formatDate(inquiry.created_at))} · ${escapeHtml(inquiry.message)}</small></div><span class="status-pill status-${escapeHtml(inquiry.priority)}">${escapeHtml(inquiry.priority)}</span></div>`).join("")
    : '<p class="empty-state">No enquiries from this email address.</p>';

  const detail = document.querySelector("#client-detail");
  detail.hidden = false;
  detail.innerHTML = `
    <div class="panel-heading"><div><p class="eyebrow">CLIENT ACCOUNT #${client.id}</p><h2>${escapeHtml(client.name)}</h2></div><button class="text-button" type="button" id="close-client-detail">Close ×</button></div>
    <form class="form-grid" id="client-update-form">
      <label>Name <input name="name" value="${escapeHtml(client.name)}" required maxlength="120"></label>
      <label>Company <input name="company" value="${escapeHtml(client.company)}" maxlength="160"></label>
      <label>Email <input name="email" type="email" value="${escapeHtml(client.email)}" maxlength="254"></label>
      <label>Phone <input name="phone" value="${escapeHtml(client.phone)}" maxlength="40"></label>
      <label>Status <select name="status">${["active", "paused", "archived"].map((status) => `<option value="${status}" ${client.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
      <label class="span-two">Account notes <textarea name="notes" rows="3" maxlength="5000">${escapeHtml(client.notes)}</textarea></label>
      <div class="form-actions span-two"><button class="button button-secondary" type="submit">Save account</button></div>
    </form>
    <div class="client-subsection"><div class="panel-heading"><div><p class="eyebrow">SERVICES & ACCOUNT VALUE</p><h2>Provided services</h2></div></div>${serviceRows}
      <form class="form-grid compact-form" id="assign-service-form">
        <label>Service <select name="service_id" required>${serviceOptions}</select></label>
        <label>Agreed price <input name="price" type="number" min="0" step="0.01" value="0" required></label>
        <label>Start date <input name="started_on" type="date"></label>
        <label>Notes <input name="notes" maxlength="2000"></label>
        <div class="form-actions span-two"><button class="button button-primary" type="submit">Assign service</button></div>
      </form>
    </div>
    <div class="client-subsection"><div class="panel-heading"><div><p class="eyebrow">SALES ANALYTICS</p><h2>Linked sales</h2></div><strong>${escapeHtml(formatMoney(client.sales.reduce((sum, sale) => sum + Number(sale.total_cents), 0)))}</strong></div>${salesRows}</div>
    <div class="client-subsection"><div class="panel-heading"><div><p class="eyebrow">CONTACT HISTORY</p><h2>Matching enquiries</h2></div></div>${inquiryRows}</div>`;
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderStore() {
  const paidSales = state.sales.filter((sale) => sale.status === "paid");
  const monthRevenue = Number(state.summary.month_revenue_cents || 0);
  const storeMetrics = [
    ["Paid sales", paidSales.length, "Recorded transactions"],
    ["Lifetime revenue", formatMoney(state.summary.lifetime_revenue_cents), "Paid sales only"],
    ["This month", formatMoney(monthRevenue), "Paid sales only"],
    ["Products", state.products.length, "In the product catalogue"],
  ];
  document.querySelector("#store-metrics").innerHTML = storeMetrics.map(([label, value, note]) => `
    <article class="metric-card"><p>${escapeHtml(label)}</p><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>
  `).join("");

  document.querySelector("#products-table").innerHTML = state.products.map((product) => `
    <tr><td class="table-primary"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku || "No SKU")}</small></td><td>${escapeHtml(formatMoney(product.price_cents))}</td><td>${product.track_inventory ? escapeHtml(product.stock_quantity) : "Not tracked"}</td><td>${escapeHtml(product.units_sold)}</td><td>${escapeHtml(formatMoney(product.revenue_cents))}</td></tr>
  `).join("");
  document.querySelector("#products-empty").hidden = state.products.length > 0;

  const saleProduct = document.querySelector("#sale-product");
  saleProduct.innerHTML = state.products.filter((product) => product.active).map((product) => `
    <option value="${product.id}">${escapeHtml(product.name)} · ${escapeHtml(formatMoney(product.price_cents))}${product.track_inventory ? ` · ${escapeHtml(product.stock_quantity)} in stock` : ""}</option>
  `).join("");
  saleProduct.disabled = saleProduct.options.length === 0;
  document.querySelector('#sale-form button[type="submit"]').disabled = saleProduct.disabled;
  document.querySelector("#sales-table").innerHTML = state.sales.map((sale) => `
    <tr><td>${escapeHtml(formatDate(sale.created_at))}</td><td>${escapeHtml(sale.client_name || sale.customer_name || "—")}</td><td>${escapeHtml(sale.items || "—")}</td><td>${escapeHtml(formatMoney(sale.total_cents))}</td></tr>
  `).join("");
  document.querySelector("#sales-empty").hidden = state.sales.length > 0;
}

function renderSuppliers() {
  document.querySelector("#suppliers-list").innerHTML = state.suppliers.map((supplier) => `
    <div class="list-row"><div class="list-main"><strong>${escapeHtml(supplier.name)}</strong><small>${escapeHtml(supplier.contact_name || supplier.email || supplier.phone || "Contact details not added")}</small></div></div>
  `).join("");
  document.querySelector("#suppliers-empty").hidden = state.suppliers.length > 0;
  const select = document.querySelector("#supply-supplier");
  select.innerHTML = state.suppliers.map((supplier) => `<option value="${supplier.id}">${escapeHtml(supplier.name)}</option>`).join("");
  select.disabled = state.suppliers.length === 0;
  document.querySelector('#supply-order-form button[type="submit"]').disabled = select.disabled;
}

function renderSupplyOrders() {
  document.querySelector("#supply-orders-table").innerHTML = state.supplyOrders.map((order) => `
    <tr><td>${escapeHtml(order.reference || `#${order.id}`)}</td><td>${escapeHtml(order.supplier_name || "—")}</td><td>${escapeHtml(order.item_count)}</td><td>${escapeHtml(formatMoney(order.total_cents))}</td><td>${escapeHtml(order.needed_by || "—")}</td><td><select class="table-select" data-supply-status="${order.id}" aria-label="Status for supply order ${order.id}">${statusOptions(["draft", "submitted", "received", "cancelled"], order.status)}</select></td></tr>
  `).join("");
  document.querySelector("#supply-orders-empty").hidden = state.supplyOrders.length > 0;
}

function statusOptions(values, selected) {
  return values.map((value) => `<option value="${value}" ${selected === value ? "selected" : ""}>${value.replaceAll("_", " ")}</option>`).join("");
}

function renderInquiries() {
  const filter = document.querySelector("#inquiry-filter").value;
  const inquiries = filter ? state.inquiries.filter((inquiry) => inquiry.status === filter) : state.inquiries;
  document.querySelector("#inquiries-table").innerHTML = inquiries.map((inquiry) => `
    <tr>
      <td>${escapeHtml(formatDate(inquiry.created_at, { dateStyle: "medium", timeStyle: "short" }))}</td>
      <td class="table-primary"><strong>${escapeHtml(inquiry.name)}</strong><small><a href="mailto:${escapeHtml(inquiry.email)}">${escapeHtml(inquiry.email)}</a>${inquiry.phone ? `<br>${escapeHtml(inquiry.phone)}` : ""}</small></td>
      <td>${escapeHtml(inquiry.service || "Open to ideas")}</td>
      <td class="inquiry-message" title="${escapeHtml(inquiry.message)}">${escapeHtml(inquiry.message)}</td>
      <td><select class="table-select" data-inquiry-priority="${inquiry.id}" aria-label="Priority for enquiry from ${escapeHtml(inquiry.name)}">${statusOptions(["normal", "high", "urgent"], inquiry.priority)}</select></td>
      <td><select class="table-select" data-inquiry-status="${inquiry.id}" aria-label="Status for enquiry from ${escapeHtml(inquiry.name)}">${statusOptions(["new", "in_progress", "converted", "closed"], inquiry.status)}</select></td>
    </tr>`).join("");
  document.querySelector("#inquiries-empty").hidden = inquiries.length > 0;
}

function renderNotifications() {
  const unread = state.notifications.filter((notification) => !notification.is_read).length;
  setCount("#alert-count", unread);
  document.querySelector("#notifications-list").innerHTML = state.notifications.map((notification) => `
    <div class="list-row alert-row">
      <div class="list-main"><strong>${escapeHtml(notification.title)}</strong><small>${escapeHtml(notification.message)} · ${escapeHtml(formatDate(notification.created_at, { dateStyle: "medium", timeStyle: "short" }))}</small></div>
      <span class="status-pill status-${escapeHtml(notification.priority)}">${escapeHtml(notification.priority)}</span>
      ${notification.is_read ? '<span class="subtle-label">Read</span>' : `<button class="text-button" type="button" data-alert-read="${notification.id}">Mark read</button>`}
    </div>`).join("");
  document.querySelector("#notifications-empty").hidden = state.notifications.length > 0;
}

function renderChannelStatus() {
  const channels = state.settings.channels || {};
  document.querySelector("#channel-status").innerHTML = Object.values(channels).map((channel) => `
    <div class="channel-card"><span>${escapeHtml(channel.label)}</span><span class="channel-status ${channel.configured ? "is-ready" : "is-off"}">${channel.configured ? "Configured" : "Setup needed"}</span></div>
  `).join("");
  const push = channels["browser-push"];
  const button = document.querySelector("#enable-push");
  button.disabled = !push?.configured || !("serviceWorker" in navigator) || !("PushManager" in window);
  button.title = button.disabled
    ? "Configure VAPID keys on the server to enable browser push."
    : "Ask this browser to receive priority alerts.";
}

function moneyToMinorUnits(value, field) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) throw new Error(`${field} must be a non-negative amount.`);
  return Math.round(amount * 100);
}

async function submitForm(form, submit) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await submit(new FormData(form));
      form.reset();
      if (form.id === "sale-form") syncUnlinkedSaleFields();
      showToast("Saved.");
      await loadDashboard();
    } catch (error) {
      showToast(error.message);
    } finally {
      if (button) {
        button.disabled = form.id === "sale-form"
          ? !state.products.some((product) => product.active)
          : form.id === "supply-order-form"
            ? state.suppliers.length === 0
            : false;
      }
    }
  });
}

function addSupplyItem(description = "", quantity = 1, unitCost = "") {
  const row = document.createElement("div");
  row.className = "order-item-row";
  row.innerHTML = `
    <input name="item_description" maxlength="200" placeholder="Item or custom specification" aria-label="Item description" value="${escapeHtml(description)}" required>
    <input name="item_quantity" type="number" min="1" max="10000" value="${escapeHtml(quantity)}" aria-label="Item quantity" required>
    <input name="item_unit_cost" type="number" min="0" step="0.01" placeholder="Unit cost" aria-label="Unit cost" value="${escapeHtml(unitCost)}" required>
    <button class="remove-item" type="button" aria-label="Remove item">×</button>`;
  row.querySelector(".remove-item").addEventListener("click", () => {
    if (document.querySelectorAll(".order-item-row").length > 1) row.remove();
    else showToast("A supply order needs at least one item.");
  });
  document.querySelector("#order-items").append(row);
}

function base64ToBytes(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function enablePush() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("Browser notifications were not enabled.");
      return;
    }
    const config = state.settings.channels["browser-push"];
    const registration = await navigator.serviceWorker.register("./sw.js");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToBytes(config.publicKey),
    });
    await api("/api/admin/push-subscriptions", {
      method: "POST",
      body: JSON.stringify(subscription),
    });
    showToast("Browser push is enabled on this device.");
  } catch (error) {
    showToast(`Could not enable browser push: ${error.message}`);
  }
}

function setView(name) {
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    const active = panel.dataset.viewPanel === name;
    panel.hidden = !active;
    panel.classList.toggle("is-visible", active);
  });
  document.querySelectorAll(".side-link[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === name);
  });
  const selected = document.querySelector(`[data-view-panel="${CSS.escape(name)}"]`);
  document.querySelector("#current-section").textContent = selected?.querySelector("h1")?.textContent || "Overview";
  document.querySelector("#sidebar").classList.remove("is-open");
  document.querySelector("#mobile-menu").setAttribute("aria-expanded", "false");
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    state.csrfToken = response.csrfToken;
    showDashboard(response.email);
    await loadDashboard();
  } catch (error) {
    loginMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    state.csrfToken = "";
    showLogin("You have signed out.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#mobile-menu").addEventListener("click", (event) => {
  const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
  event.currentTarget.setAttribute("aria-expanded", String(!expanded));
  document.querySelector("#sidebar").classList.toggle("is-open", !expanded);
});

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) setView(viewButton.dataset.view);
  const toggleButton = event.target.closest("[data-toggle-form]");
  if (toggleButton) {
    const panel = document.querySelector(`#${CSS.escape(toggleButton.dataset.toggleForm)}-panel`);
    if (panel) panel.open = !panel.open;
  }
  const clientButton = event.target.closest("[data-client-detail]");
  if (clientButton) {
    try {
      await openClient(clientButton.dataset.clientDetail);
    } catch (error) {
      showToast(error.message);
    }
  }
  if (event.target.closest("#close-client-detail")) {
    state.activeClient = null;
    document.querySelector("#client-detail").hidden = true;
  }
  const readButton = event.target.closest("[data-alert-read]");
  if (readButton) {
    try {
      await api(`/api/admin/notifications/${readButton.dataset.alertRead}`, {
        method: "PATCH",
        body: JSON.stringify({ is_read: true }),
      });
      await loadDashboard();
    } catch (error) {
      showToast(error.message);
    }
  }
});

document.querySelector("#inquiry-filter").addEventListener("change", renderInquiries);
document.querySelector("#sale-client").addEventListener("change", syncUnlinkedSaleFields);
document.querySelector("#enable-push").addEventListener("click", enablePush);
document.querySelector("#add-order-item").addEventListener("click", () => addSupplyItem());
document.querySelector("#mark-alerts-read").addEventListener("click", async () => {
  try {
    await Promise.all(state.notifications.filter((notification) => !notification.is_read).map((notification) =>
      api(`/api/admin/notifications/${notification.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_read: true }),
      })));
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  }
});

submitForm(document.querySelector("#client-form"), async (form) => {
  await api("/api/admin/clients", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(form)),
  });
  document.querySelector("#client-form-panel").open = false;
});

submitForm(document.querySelector("#service-form"), async (form) => {
  await api("/api/admin/services", {
    method: "POST",
    body: JSON.stringify({
      name: form.get("name"),
      description: form.get("description"),
      default_price_cents: moneyToMinorUnits(form.get("default_price"), "Default price"),
    }),
  });
});

submitForm(document.querySelector("#product-form"), async (form) => {
  await api("/api/admin/products", {
    method: "POST",
    body: JSON.stringify({
      name: form.get("name"),
      sku: form.get("sku"),
      price_cents: moneyToMinorUnits(form.get("price"), "Price"),
      stock_quantity: Number(form.get("stock_quantity") || 0),
      track_inventory: form.get("track_inventory") === "on",
    }),
  });
});

submitForm(document.querySelector("#sale-form"), async (form) => {
  await api("/api/admin/sales", {
    method: "POST",
    body: JSON.stringify({
      product_id: Number(form.get("product_id")),
      quantity: Number(form.get("quantity")),
      client_id: form.get("client_id") || null,
      customer_name: form.get("customer_name"),
      customer_email: form.get("customer_email"),
    }),
  });
});

submitForm(document.querySelector("#supplier-form"), async (form) => {
  await api("/api/admin/suppliers", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(form)),
  });
});

submitForm(document.querySelector("#supply-order-form"), async (form) => {
  const rows = [...document.querySelectorAll(".order-item-row")];
  const items = rows.map((row) => ({
    description: row.querySelector('[name="item_description"]').value,
    quantity: Number(row.querySelector('[name="item_quantity"]').value),
    unit_cost_cents: moneyToMinorUnits(row.querySelector('[name="item_unit_cost"]').value, "Item unit cost"),
  }));
  await api("/api/admin/supply-orders", {
    method: "POST",
    body: JSON.stringify({
      supplier_id: Number(form.get("supplier_id")),
      reference: form.get("reference"),
      needed_by: form.get("needed_by"),
      notes: form.get("notes"),
      items,
    }),
  });
  document.querySelector("#order-items").replaceChildren();
  addSupplyItem();
});

submitForm(document.querySelector("#currency-form"), async (form) => {
  const currency = String(form.get("currency")).trim().toUpperCase();
  const response = await api("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({ currency }),
  });
  state.currency = response.currency;
});

document.querySelector("#client-detail").addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    if (form.id === "client-update-form") {
      await api(`/api/admin/clients/${state.activeClient.id}`, {
        method: "PATCH",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
    } else if (form.id === "assign-service-form") {
      const values = new FormData(form);
      await api(`/api/admin/clients/${state.activeClient.id}/services`, {
        method: "POST",
        body: JSON.stringify({
          service_id: Number(values.get("service_id")),
          price_cents: moneyToMinorUnits(values.get("price"), "Agreed price"),
          started_on: values.get("started_on"),
          notes: values.get("notes"),
        }),
      });
    } else {
      return;
    }
    await loadDashboard();
    await openClient(state.activeClient.id);
    showToast("Client account updated.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#inquiries-table").addEventListener("change", async (event) => {
  const control = event.target;
  const inquiryId = control.dataset.inquiryStatus || control.dataset.inquiryPriority;
  if (!inquiryId) return;
  const field = control.dataset.inquiryStatus ? "status" : "priority";
  try {
    await api(`/api/admin/inquiries/${inquiryId}`, {
      method: "PATCH",
      body: JSON.stringify({ [field]: control.value }),
    });
    await loadDashboard();
    showToast("Enquiry updated.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#supply-orders-table").addEventListener("change", async (event) => {
  const control = event.target;
  const orderId = control.dataset.supplyStatus;
  if (!orderId) return;
  try {
    await api(`/api/admin/supply-orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: control.value }),
    });
    await loadDashboard();
    showToast("Supply order updated.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#supply-order-form").addEventListener("reset", () => {
  window.setTimeout(() => {
    document.querySelector("#order-items").replaceChildren();
    addSupplyItem();
  });
});

document.querySelector("#account-email").textContent = "Admin";
document.querySelector("#today-label").textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date());
addSupplyItem();

api("/api/auth/session").then((session) => {
  if (!session.authenticated) {
    showLogin();
    return;
  }
  state.csrfToken = session.csrfToken;
  showDashboard(session.email);
  return loadDashboard();
}).catch((error) => {
  showLogin(`Admin service is unavailable: ${error.message}`);
});
