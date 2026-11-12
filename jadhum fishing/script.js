(() => {
    const productGrid = document.querySelector(".product-grid");
    if (productGrid && window.location.protocol !== "file:") {
        fetch("/api/products")
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Product catalog request failed with status ${response.status}.`);
                }
                return response.json();
            })
            .then(({ products: catalogProducts }) => {
                if (!Array.isArray(catalogProducts)) {
                    throw new Error("Product catalog response is invalid.");
                }
                const fragment = document.createDocumentFragment();
                for (const product of catalogProducts) {
                    const card = document.createElement("article");
                    card.className = "product-card";
                    card.dataset.productId = product.id;

                    const image = document.createElement("img");
                    image.className = "product-image";
                    image.src = product.image;
                    image.alt = product.name;
                    image.loading = "lazy";

                    const content = document.createElement("div");
                    content.className = "product-card-content";
                    const name = document.createElement("h3");
                    name.textContent = product.name;
                    const category = document.createElement("p");
                    category.className = "product-category";
                    category.textContent = product.categoryName;
                    const description = document.createElement("p");
                    description.textContent = product.description;
                    const price = document.createElement("p");
                    price.className = "product-price";
                    price.textContent = product.price === null
                        ? "Ask us for this product's price"
                        : new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(product.price);
                    const button = document.createElement("button");
                    button.className = "add-to-cart";
                    button.type = "button";
                    button.textContent = "Add to quote list";
                    content.append(name, category, description, price, button);
                    card.append(image, content);
                    fragment.append(card);
                }
                productGrid.replaceChildren(fragment);
                initializeCart();
            })
            .catch((error) => {
                console.error("Could not load the live product catalog; showing the saved catalog instead.", error);
                initializeCart();
            });
    } else {
        initializeCart();
    }

    function initializeCart() {
    const productCards = Array.from(document.querySelectorAll(".product-card[data-product-id]"));
    const products = new Map(
        productCards.map((card) => [
            card.dataset.productId,
            {
                id: card.dataset.productId,
                name: card.querySelector("h3").textContent.trim(),
                image: card.querySelector(".product-image").getAttribute("src"),
                price: card.querySelector(".product-price").textContent.trim(),
            },
        ]),
    );
    const cart = new Map();
    const storageKey = "jadhum-fishing-cart";
    const cartDialog = document.querySelector("#cart-dialog");
    const openCartButton = document.querySelector("#open-cart");
    const closeCartButton = document.querySelector("#close-cart");
    const cartItems = document.querySelector("#cart-items");
    const emptyMessage = document.querySelector("#cart-empty");
    const cartCount = document.querySelector("#cart-count");
    const totalItems = document.querySelector("#cart-total-items");
    const quoteActions = document.querySelector("#quote-actions");
    const emailQuote = document.querySelector("#email-quote");
    const emailAppQuote = document.querySelector("#email-app-quote");
    const whatsappQuote = document.querySelector("#whatsapp-quote");
    const smsQuote = document.querySelector("#sms-quote");
    const quoteReference = document.querySelector("#quote-reference");
    const quoteReferenceValue = document.querySelector("#quote-reference-value");
    const status = document.querySelector("#cart-status");

    if (
        productCards.length === 0 ||
        !cartDialog ||
        !openCartButton ||
        !closeCartButton ||
        !cartItems ||
        !emptyMessage ||
        !cartCount ||
        !totalItems ||
        !quoteActions ||
        !emailQuote ||
        !emailAppQuote ||
        !whatsappQuote ||
        !smsQuote ||
        !quoteReference ||
        !quoteReferenceValue ||
        !status
    ) {
        console.error("Shopping cart setup failed: required page elements are missing.");
        return;
    }

    let statusTimer;
    let activeQuotation = null;
    let quotationRequestInProgress = false;

    function showStatus(message) {
        window.clearTimeout(statusTimer);
        status.textContent = message;
        statusTimer = window.setTimeout(() => {
            status.textContent = "";
        }, 3200);
    }

    function saveCart() {
        try {
            localStorage.setItem(storageKey, JSON.stringify(Array.from(cart.entries())));
            return true;
        } catch (error) {
            console.error("Shopping cart could not be saved to browser storage.", error);
            showStatus("Your cart works for this visit, but this browser could not save it.");
            return false;
        }
    }

    function loadCart() {
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved === null) {
                return;
            }

            const entries = JSON.parse(saved);
            if (!Array.isArray(entries)) {
                throw new Error("Saved cart data is not a list.");
            }

            for (const entry of entries) {
                if (
                    !Array.isArray(entry) ||
                    entry.length !== 2 ||
                    !products.has(entry[0]) ||
                    !Number.isInteger(entry[1]) ||
                    entry[1] < 1
                ) {
                    throw new Error("Saved cart contains an invalid item.");
                }
                cart.set(entry[0], entry[1]);
            }
        } catch (error) {
            console.error("Shopping cart data could not be loaded.", error);
            showStatus("A saved cart could not be loaded. Add your items again.");
        }
    }

    function createQuantityButton(label, action, productId) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "quantity-button";
        button.dataset.action = action;
        button.dataset.productId = productId;
        button.setAttribute("aria-label", label);
        button.textContent = action === "increase" ? "+" : "−";
        return button;
    }

    function cartSnapshot() {
        return Array.from(cart, ([id, quantity]) => ({ id, quantity }));
    }

    function cartKey() {
        return JSON.stringify(Array.from(cart.entries()));
    }

    function createLocalReference() {
        const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
        const randomPart = Array.from(
            window.crypto.getRandomValues(new Uint8Array(4)),
            (value) => value.toString(16).padStart(2, "0"),
        ).join("").toUpperCase();
        return `JAD-LOCAL-${datePart}-${randomPart}`;
    }

    function buildRequestMessage(reference, items) {
        const lines = items.map((item) => `${products.get(item.id).name} (quantity: ${item.quantity})`);
        const message = [
            "Hello Jadhum Fishing Equipments,",
            "",
            `Quotation reference: ${reference}`,
            "",
            "Please share the current price for each of these products:",
            ...lines.map((line) => `- ${line}`),
            "",
            "Thank you.",
        ].join("\n");
        return message;
    }

    function buildRequestUrl(channel, reference, items) {
        const message = buildRequestMessage(reference, items);
        const subject = `Price request ${reference} - Jadhum Fishing Equipments`;

        if (channel === "email") {
            const gmailUrl = new URL("https://mail.google.com/mail/");
            gmailUrl.searchParams.set("view", "cm");
            gmailUrl.searchParams.set("fs", "1");
            gmailUrl.searchParams.set("to", "odhulobama@gmail.com");
            gmailUrl.searchParams.set("su", subject);
            gmailUrl.searchParams.set("body", message);
            return gmailUrl.toString();
        }
        if (channel === "email-app") {
            return `mailto:odhulobama@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
        }
        if (channel === "whatsapp") {
            return `https://wa.me/254727487448?text=${encodeURIComponent(message)}`;
        }
        return `sms:+254727487448?body=${encodeURIComponent(message)}`;
    }

    async function requestQuotation(channel) {
        if (quotationRequestInProgress) {
            showStatus("Your quotation is being saved.");
            return;
        }

        const requestedItemsKey = cartKey();
        const requestedItems = cartSnapshot();
        const destination = window.open("about:blank", "_blank");
        if (!destination) {
            showStatus("Allow pop-ups to open your quote request.");
            return;
        }
        destination.opener = null;
        quotationRequestInProgress = true;

        try {
            if (!activeQuotation || activeQuotation.itemsKey !== requestedItemsKey) {
                const quotation = {
                    reference: createLocalReference(),
                    itemsKey: requestedItemsKey,
                    items: requestedItems,
                    saved: false,
                };

                if (window.location.protocol !== "file:") {
                    try {
                        const response = await fetch("/api/quotations", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                items: requestedItems,
                                channel: channel === "email-app" ? "email" : channel,
                            }),
                        });
                        const result = await response.json();
                        if (!response.ok) {
                            throw new Error(result.error || "The quotation could not be saved.");
                        }
                        quotation.reference = result.reference;
                        quotation.saved = true;
                    } catch (error) {
                        console.error("Quotation could not be saved to the admin database.", error);
                    }
                }

                if (cartKey() === requestedItemsKey) {
                    activeQuotation = quotation;
                    quoteReferenceValue.textContent = quotation.reference;
                    quoteReference.hidden = false;
                }
                destination.location.replace(buildRequestUrl(channel, quotation.reference, requestedItems));
                showStatus(
                    quotation.saved
                        ? `Request ${quotation.reference} saved. Review and send your message.`
                        : `Message opened with reference ${quotation.reference}. Open the store through the server to save requests in the admin dashboard.`,
                );
                return;
            }

            destination.location.replace(buildRequestUrl(channel, activeQuotation.reference, activeQuotation.items));
            showStatus(
                activeQuotation.saved
                    ? `Request ${activeQuotation.reference} saved. Review and send your message.`
                    : `Message opened with reference ${activeQuotation.reference}. This request is not saved in the admin dashboard.`,
            );
        } catch (error) {
            console.error("Quotation request could not be saved.", error);
            destination.close();
            showStatus("Could not open your message. Allow pop-ups and try again.");
        } finally {
            quotationRequestInProgress = false;
        }
    }

    function clearActiveQuotation() {
        activeQuotation = null;
        quoteReferenceValue.textContent = "";
        quoteReference.hidden = true;
    }

    function updateQuoteLinks() {
        quoteActions.hidden = cart.size === 0;
    }

    function renderCart() {
        let count = 0;
        cartItems.replaceChildren();

        for (const [productId, quantity] of cart) {
            const product = products.get(productId);
            count += quantity;

            const row = document.createElement("article");
            row.className = "cart-item";

            const image = document.createElement("img");
            image.src = product.image;
            image.alt = "";

            const details = document.createElement("div");
            details.className = "cart-item-details";

            const name = document.createElement("h3");
            name.textContent = product.name;

            const price = document.createElement("p");
            price.className = "cart-item-price";
            price.textContent = product.price;

            const controls = document.createElement("div");
            controls.className = "cart-item-controls";

            const quantityControl = document.createElement("div");
            quantityControl.className = "quantity-control";
            quantityControl.append(
                createQuantityButton(`Remove one ${product.name}`, "decrease", productId),
            );

            const quantityLabel = document.createElement("span");
            quantityLabel.className = "quantity-value";
            quantityLabel.textContent = String(quantity);
            quantityLabel.setAttribute("aria-label", `Quantity: ${quantity}`);
            quantityControl.append(
                quantityLabel,
                createQuantityButton(`Add one ${product.name}`, "increase", productId),
            );

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "remove-item";
            removeButton.dataset.action = "remove";
            removeButton.dataset.productId = productId;
            removeButton.textContent = "Remove";

            controls.append(quantityControl, removeButton);
            details.append(name, price, controls);
            row.append(image, details);
            cartItems.append(row);
        }

        cartCount.textContent = String(count);
        cartCount.setAttribute("aria-label", `${count} items in cart`);
        totalItems.textContent = String(count);
        emptyMessage.hidden = cart.size > 0;
        updateQuoteLinks();
    }

    openCartButton.addEventListener("click", () => cartDialog.showModal());
    closeCartButton.addEventListener("click", () => cartDialog.close());
    cartDialog.addEventListener("click", (event) => {
        if (event.target === cartDialog) {
            cartDialog.close();
        }
    });

    for (const card of productCards) {
        const button = card.querySelector(".add-to-cart");
        if (!button) {
            console.error(`Shopping cart setup failed: add button is missing for ${card.dataset.productId}.`);
            continue;
        }

        button.addEventListener("click", () => {
            const productId = card.dataset.productId;
            cart.set(productId, (cart.get(productId) || 0) + 1);
            clearActiveQuotation();
            const saved = saveCart();
            renderCart();
            if (saved) {
                showStatus(`${products.get(productId).name} added to your quote list.`);
            }
        });
    }

    cartItems.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) {
            return;
        }

        const productId = button.dataset.productId;
        const quantity = cart.get(productId);
        if (!quantity) {
            return;
        }

        if (button.dataset.action === "remove" || (button.dataset.action === "decrease" && quantity === 1)) {
            cart.delete(productId);
        } else if (button.dataset.action === "decrease") {
            cart.set(productId, quantity - 1);
        } else if (button.dataset.action === "increase") {
            cart.set(productId, quantity + 1);
        } else {
            console.error(`Shopping cart received an unknown action: ${button.dataset.action}.`);
            return;
        }

        clearActiveQuotation();
        saveCart();
        renderCart();
    });

    for (const [link, channel] of [
        [emailQuote, "email"],
        [emailAppQuote, "email-app"],
        [whatsappQuote, "whatsapp"],
        [smsQuote, "sms"],
    ]) {
        link.addEventListener("click", (event) => {
            event.preventDefault();
            if (cart.size === 0) {
                showStatus("Add products to your quote list first.");
                return;
            }
            requestQuotation(channel);
        });
    }

    loadCart();
    renderCart();
    }
})();
