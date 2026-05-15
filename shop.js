(function(){
  const grid = document.getElementById("shopGrid");
  const empty = document.getElementById("shopEmpty");
  const form = document.getElementById("shopPrintForm");
  const typeField = document.getElementById("shop-type");
  const timingField = document.getElementById("shop-timing");
  const messageField = document.getElementById("shop-message");
  const selection = document.getElementById("contactSelection");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const config = window.SHOP_CONFIG || {};
  const productIndex = new Map();

  if(!grid || !empty || !form || !messageField){
    return;
  }

  function escapeHtml(value){
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildProductCard(item){
    const article = document.createElement("article");
    article.className = "product-card";

    const imageVersion = item.imageVersion ? ("?v=" + encodeURIComponent(item.imageVersion)) : "";
    const mediaStart = item.etsyUrl
      ? '<a class="product-card-media product-card-link" href="' + escapeHtml(item.etsyUrl) + '" target="_blank" rel="noopener">'
      : '<div class="product-card-media">';
    const mediaEnd = item.etsyUrl ? "</a>" : "</div>";
    const etsyButton = item.etsyUrl
      ? '<a class="btn primary mini-button product-etsy" href="' + escapeHtml(item.etsyUrl) + '" target="_blank" rel="noopener">View on Etsy</a>'
      : "";

    article.innerHTML =
      mediaStart +
        (item.image
          ? '<img src="' + escapeHtml(item.image + imageVersion) + '" alt="' + escapeHtml(item.title) + '" loading="lazy" />'
          : '<div class="product-card-fallback">No preview</div>') +
      mediaEnd +
      '<div class="product-card-body">' +
        '<strong>' + escapeHtml(item.title) + '</strong>' +
        '<span class="product-card-price">' + escapeHtml(item.priceLabel || "Quote") + '</span>' +
        '<p>' + escapeHtml(item.description || "Ask about materials, sizing, and lead time.") + '</p>' +
        '<div class="product-card-actions">' +
          etsyButton +
          '<button class="btn secondary product-inquire" type="button" data-product-id="' + escapeHtml(item.id) + '">Ask about this print</button>' +
        '</div>' +
      '</div>';

    return article;
  }

  function prefillInquiry(item){
    if(typeField){
      typeField.value = item.etsyUrl ? "Etsy listing question" : "Custom print request";
    }

    if(timingField && !timingField.value.trim()){
      timingField.value = "Please follow up with pricing and lead time.";
    }

    const nextMessage =
      item.inquiryMessage ||
      ("I am interested in the " + item.title + (item.priceLabel ? " (" + item.priceLabel + ")" : "") + ". Please tell me the current price, material options, and lead time.");

    if(!messageField.value.trim() || messageField.dataset.autoFilled === "true"){
      messageField.value = nextMessage;
      messageField.dataset.autoFilled = "true";
    }

    if(selection){
      const fragments = [item.title];
      if(item.priceLabel){
        fragments.push(item.priceLabel);
      }
      selection.textContent = "Selected print: " + fragments.join(" - ");
      selection.hidden = false;
    }

    form.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    const nameField = document.getElementById("shop-name");
    if(nameField && !nameField.value.trim()){
      nameField.focus();
    }else{
      messageField.focus();
    }
  }

  function renderCatalog(items){
    const normalized = Array.isArray(items) ? items.filter(function(item){
      return item && item.id && item.title;
    }) : [];

    productIndex.clear();
    normalized.forEach(function(item){
      productIndex.set(item.id, item);
    });

    grid.innerHTML = "";
    if(!normalized.length){
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    normalized.forEach(function(item){
      grid.appendChild(buildProductCard(item));
    });
  }

  async function loadCatalog(){
    if(!config.productCatalogUrl){
      renderCatalog([]);
      return;
    }

    try{
      const response = await fetch(config.productCatalogUrl + "?ts=" + Date.now(), { cache: "no-store" });
      if(!response.ok){
        throw new Error("Catalog request failed");
      }
      const data = await response.json();
      renderCatalog(data.items || []);
    }catch(error){
      renderCatalog([]);
    }
  }

  messageField.addEventListener("input", function(){
    if(messageField.dataset.autoFilled === "true" && !messageField.value.trim()){
      messageField.dataset.autoFilled = "false";
    }
  });

  grid.addEventListener("click", function(event){
    const button = event.target.closest(".product-inquire");
    if(!button){
      return;
    }

    const item = productIndex.get(button.dataset.productId);
    if(!item){
      return;
    }

    prefillInquiry(item);
  });

  loadCatalog();
})();
