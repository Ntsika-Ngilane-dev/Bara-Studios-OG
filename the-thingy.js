const screens = document.querySelectorAll("[data-screen]");
const branchList = document.querySelector("#branch-list");
const productGrid = document.querySelector("#product-grid");
const categoryTabs = document.querySelector("#category-tabs");
const cartPanel = document.querySelector("#cart-panel");
const cartBackdrop = document.querySelector("#cart-backdrop");
const cartItems = document.querySelector("#cart-items");
const checkoutItems = document.querySelector("#checkout-items");
const formatter = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });

const branches = [
  { name: "The Thingy Kensington", area: "Shop 6B, Queens Place Centre, 141 Queen St, Kensington, Johannesburg" },
  { name: "The Thingy Bedfordview", area: "Shop G07, Keywest Centre, 43 Van Buuren Rd, Bedfordview" },
  { name: "The Thingy 14th Avenue", area: "Retail Shop 12, Corner 14th Avenue and Hendrik Potgieter Rd, Constantia Kloof" },
  { name: "The Thingy Hatfield Gateway", area: "1319 Pretorius St, Hatfield, Pretoria" },
  { name: "The Thingy Eastleigh", area: "Shop 6, 2 North Rd, Eastleigh, Edenvale" },
  { name: "The Thingy Linksfield", area: "110 Linksfield Rd, Linksfield, Johannesburg" },
  { name: "The Thingy Greenstone", area: "MAG Building, 42 Longmeadow Blvd, Westfield, Edenvale" },
  { name: "The Thingy Madelief", area: "Shop 14B, 754 Bokmakierie St, Madelief" },
  { name: "The Thingy Primrose Hill", area: "123 Cydonia Rd, Primrose Hill, Germiston" },
  { name: "The Thingy Honeyrock", area: "Hut 7, Corner Beyers Naude Dr and Juice St, Honeydew" },
  { name: "The Thingy Pretoria", area: "Shop 18, Olive Wood Shopping Centre, Corner Wekker Rd and De Villebois Mareuil Dr, Moreleta Park" },
  { name: "The Thingy Sass Centre", area: "1A Iris Rd, Bedfordview" },
  { name: "The Thingy Cradleview", area: "Shop 18, Cradleview Shopping Centre, Hendrik Potgieter Rd, Krugersdorp" },
];

const products = [
  { id: "coffee", name: "House blend coffee", category: "Drinks", price: 42, symbol: "☕" },
  { id: "tonic", name: "Citrus garden tonic", category: "Drinks", price: 38, symbol: "✳" },
  { id: "brownie", name: "Bara brownie", category: "Treats", price: 32, symbol: "▰" },
  { id: "cookie", name: "Choc-chip cookie", category: "Treats", price: 24, symbol: "◉" },
  { id: "tote", name: "The Thingy tote", category: "Goods", price: 160, symbol: "♧" },
  { id: "notebook", name: "Little ideas notebook", category: "Goods", price: 95, symbol: "▤" },
  { id: "granola", name: "Morning glow granola", category: "Pantry", price: 88, symbol: "✺" },
  { id: "honey", name: "Local wildflower honey", category: "Pantry", price: 110, symbol: "◇" },
];

let selectedBranch = null;
let activeCategory = "All";
let customerName = "";
let cart = [];
cartPanel.inert = true;
try {
  const savedCart = JSON.parse(sessionStorage.getItem("thingy-cart") || "[]");
  if (Array.isArray(savedCart)) {
    cart = savedCart.filter((item) =>
      products.some((product) => product.id === item.id) &&
      Number.isInteger(item.quantity) &&
      item.quantity > 0,
    );
  }
} catch (error) {
  console.error("Could not restore the Thingy basket from this session.", error);
}

document.querySelectorAll(".current-year").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

function showScreen(name) {
  screens.forEach((screen) => {
    screen.hidden = screen.dataset.screen !== name;
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function productFor(id) {
  return products.find((product) => product.id === id);
}

function totalQuantity() {
  return cart.reduce((total, item) => total + item.quantity, 0);
}

function cartTotal() {
  return cart.reduce((total, item) => total + productFor(item.id).price * item.quantity, 0);
}

function saveCart() {
  sessionStorage.setItem("thingy-cart", JSON.stringify(cart));
}

function renderBranches() {
  branchList.replaceChildren();
  branches.forEach((branch, index) => {
    const button = document.createElement("button");
    button.className = "branch-card";
    button.type = "button";
    const branchNumber = String(index + 1).padStart(2, "0");
    button.innerHTML = `<span class="branch-number">BRANCH ${branchNumber}</span><span class="branch-name"></span><span class="branch-location"></span><span class="branch-arrow">Choose this branch →</span>`;
    button.querySelector(".branch-name").textContent = branch.name;
    button.querySelector(".branch-location").textContent = branch.area;
    button.addEventListener("click", () => {
      selectedBranch = branch;
      document.querySelector("#selected-branch-label").textContent = `${branch.name} · ${branch.area}`;
      showScreen("login");
    });
    branchList.append(button);
  });
}

function renderCategories() {
  const categories = ["All", ...new Set(products.map((product) => product.category))];
  categoryTabs.replaceChildren();
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-tab";
    button.textContent = category;
    button.setAttribute("aria-pressed", String(category === activeCategory));
    button.addEventListener("click", () => {
      activeCategory = category;
      renderCategories();
      renderProducts();
    });
    categoryTabs.append(button);
  });
}

function renderProducts() {
  productGrid.replaceChildren();
  const visibleProducts = activeCategory === "All"
    ? products
    : products.filter((product) => product.category === activeCategory);

  visibleProducts.forEach((product) => {
    const article = document.createElement("article");
    article.className = "product-card";
    article.innerHTML = `<div class="product-art" aria-hidden="true"><span></span></div><div class="product-info"><span class="product-category"></span><h3></h3><div class="product-bottom"><span class="product-price"></span><button class="add-to-cart" type="button" aria-label="Add item to basket">+</button></div></div>`;
    article.querySelector(".product-art span").textContent = product.symbol;
    article.querySelector(".product-category").textContent = product.category;
    article.querySelector("h3").textContent = product.name;
    article.querySelector(".product-price").textContent = formatter.format(product.price);
    const addButton = article.querySelector(".add-to-cart");
    addButton.setAttribute("aria-label", `Add ${product.name} to basket`);
    addButton.addEventListener("click", () => updateCart(product.id, 1));
    productGrid.append(article);
  });
}

function renderCart() {
  const count = totalQuantity();
  document.querySelector("#cart-count").textContent = String(count);
  document.querySelector("#cart-total").textContent = formatter.format(cartTotal());
  document.querySelector("#checkout-total").textContent = formatter.format(cartTotal());
  document.querySelector("[data-go-checkout]").disabled = count === 0;
  cartItems.replaceChildren();
  checkoutItems.replaceChildren();

  if (!cart.length) {
    const empty = document.createElement("p");
    empty.className = "cart-empty";
    empty.textContent = "Your basket is waiting for something good.";
    cartItems.append(empty);
    const checkoutEmpty = empty.cloneNode(true);
    checkoutItems.append(checkoutEmpty);
    return;
  }

  cart.forEach((item) => {
    const product = productFor(item.id);
    const row = document.createElement("div");
    row.className = "cart-row";
    row.innerHTML = `<div><div class="cart-row-name"></div><div class="cart-row-price"></div></div><div class="quantity-control"><button type="button" aria-label="Remove one">−</button><span></span><button type="button" aria-label="Add one">+</button></div>`;
    row.querySelector(".cart-row-name").textContent = product.name;
    row.querySelector(".cart-row-price").textContent = formatter.format(product.price * item.quantity);
    row.querySelector(".quantity-control span").textContent = String(item.quantity);
    row.querySelectorAll(".quantity-control button")[0].addEventListener("click", () => updateCart(item.id, -1));
    row.querySelectorAll(".quantity-control button")[1].addEventListener("click", () => updateCart(item.id, 1));
    cartItems.append(row);

    const summaryLine = document.createElement("div");
    summaryLine.className = "summary-line";
    const productLabel = document.createElement("span");
    productLabel.textContent = `${product.name} × ${item.quantity}`;
    const priceLabel = document.createElement("strong");
    priceLabel.textContent = formatter.format(product.price * item.quantity);
    summaryLine.append(productLabel, priceLabel);
    checkoutItems.append(summaryLine);
  });
}

function updateCart(id, quantityChange) {
  const existing = cart.find((item) => item.id === id);
  if (existing) {
    existing.quantity += quantityChange;
    if (existing.quantity <= 0) cart = cart.filter((item) => item.id !== id);
  } else if (quantityChange > 0) {
    cart.push({ id, quantity: quantityChange });
  }
  saveCart();
  renderCart();
}

function openCart() {
  cartPanel.hidden = false;
  cartPanel.classList.add("is-open");
  cartPanel.setAttribute("aria-hidden", "false");
  cartPanel.inert = false;
  cartBackdrop.hidden = false;
  document.body.style.overflow = "hidden";
  cartPanel.querySelector(".cart-close").focus();
}

function closeCart() {
  cartPanel.classList.remove("is-open");
  cartPanel.setAttribute("aria-hidden", "true");
  cartPanel.inert = true;
  cartPanel.hidden = true;
  cartBackdrop.hidden = true;
  document.body.style.overflow = "";
}

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.go));
});

document.querySelectorAll("[data-open-cart]").forEach((button) => {
  button.addEventListener("click", openCart);
});
document.querySelectorAll("[data-close-cart]").forEach((button) => {
  button.addEventListener("click", closeCart);
});
cartBackdrop.addEventListener("click", closeCart);
document.querySelector("[data-go-checkout]").addEventListener("click", () => {
  closeCart();
  document.querySelector("#checkout-branch-label").textContent = selectedBranch ? `${selectedBranch.name} · ${selectedBranch.area}` : "";
  showScreen("checkout");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && cartPanel.classList.contains("is-open")) closeCart();
});

document.querySelector("#supply-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  document.querySelector("#supply-status").textContent = "Thanks for sharing your details. This preview does not submit or store supplier applications yet.";
});

document.querySelector("#login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const formData = new FormData(event.currentTarget);
  customerName = String(formData.get("name")).trim();
  document.querySelector("#store-branch-name").textContent = selectedBranch ? selectedBranch.name : "The menu.";
  document.querySelector("#checkout-status").textContent = "";
  showScreen("store");
});

document.querySelectorAll('input[name="fulfilment"]').forEach((input) => {
  input.addEventListener("change", () => {
    document.querySelector("#delivery-fields").hidden = input.value !== "delivery" || !input.checked;
    document.querySelector('[name="rideLink"]').required = input.value === "delivery" && input.checked;
  });
});

document.querySelector("#checkout-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const fulfilment = new FormData(form).get("fulfilment");
  const greeting = customerName ? `, ${customerName}` : "";
  const details = fulfilment === "pickup"
    ? `Pickup at ${selectedBranch ? selectedBranch.name : "your selected branch"}`
    : "Delivery details are ready for review";
  document.querySelector("#checkout-status").textContent = `Preview only${greeting}: ${details}. No order was sent and no payment was taken.`;
});

renderBranches();
renderCategories();
renderProducts();
renderCart();
