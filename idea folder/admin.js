(() => {
    const loginPanel = document.querySelector("#login-panel");
    const dashboard = document.querySelector("#dashboard");
    const loginForm = document.querySelector("#login-form");
    const passwordInput = document.querySelector("#admin-password");
    const loginMessage = document.querySelector("#login-message");
    const dashboardMessage = document.querySelector("#dashboard-message");
    const quotationStatuses = [
        ["pending", "New"],
        ["priced", "Price sent"],
        ["ordered", "Order recorded"],
        ["closed", "Closed"],
    ];
    const orderStatuses = [
        ["received", "Received"],
        ["processing", "Processing"],
        ["completed", "Completed"],
        ["cancelled", "Cancelled"],
    ];
    let activeView = "overview";
    let searchTimer;

    function setMessage(element, message, isError = false) {
        element.textContent = message;
        element.classList.toggle("error-message", isError);
    }

    async function requestJson(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...options.headers,
            },
        });
        const result = await response.json();
        if (!response.ok) {
            const error = new Error(result.error || "The request failed.");
            error.status = response.status;
            throw error;
        }
        return result;
    }

    function showDashboard() {
        loginPanel.hidden = true;
        dashboard.hidden = false;
    }

    function showLogin() {
        dashboard.hidden = true;
        loginPanel.hidden = false;
        passwordInput.focus();
    }

    function makeElement(tag, className = "", text) {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    }

    function formatDate(value) {
        if (!value) {
            return "—";
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }

    function formatMoney(value) {
        return value === null || value === undefined
            ? "Not recorded"
            : new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(value);
    }

    function setOptions(select, values, placeholder) {
        select.replaceChildren();
        if (placeholder) {
            const option = makeElement("option", "", placeholder);
            option.value = "";
            select.append(option);
        }
        for (const value of values) {
            const option = makeElement("option", "", value.label);
            option.value = value.value;
            select.append(option);
        }
    }

    async function loadOverview() {
        const result = await requestJson("/api/admin/overview");
        const statsGrid = document.querySelector("#stats-grid");
        const labels = [
            ["Products", result.stats.products],
            ["Categories", result.stats.categories],
            ["Customers", result.stats.customers],
            ["Orders", result.stats.orders],
            ["Open orders", result.stats.openOrders],
            ["New quotations", result.stats.pendingQuotations],
            ["Recorded sales", formatMoney(result.stats.recordedSales)],
        ];
        statsGrid.replaceChildren();
        for (const [label, value] of labels) {
            const card = makeElement("article", "stat-card");
            card.append(makeElement("span", "stat-label", label), makeElement("strong", "stat-value", String(value)));
            statsGrid.append(card);
        }

        const list = document.querySelector("#activity-list");
        list.replaceChildren();
        if (result.activity.length === 0) {
            list.append(makeElement("p", "empty-results", "Business activity will appear here."));
        } else {
            for (const item of result.activity) {
                const row = makeElement("article", "activity-row");
                row.append(
                    makeElement("span", "activity-description", item.description),
                    makeElement("time", "activity-date", formatDate(item.created_at)),
                );
                list.append(row);
            }
        }
    }

    function makeStatusSelect(statuses, selected, label) {
        const select = makeElement("select", "status-select");
        select.setAttribute("aria-label", label);
        setOptions(select, statuses.map(([value, name]) => ({ value, label: name })));
        select.value = selected;
        return select;
    }

    async function loadQuotations() {
        const query = new URLSearchParams({
            q: document.querySelector("#quotation-search").value.trim(),
            status: document.querySelector("#quotation-filter").value,
        });
        const result = await requestJson(`/api/admin/quotations?${query}`);
        const list = document.querySelector("#quotation-list");
        list.replaceChildren();
        if (result.quotations.length === 0) {
            list.append(makeElement("p", "empty-results", "No quotation requests match this search."));
            return;
        }

        for (const quotation of result.quotations) {
            const card = makeElement("article", "quotation-card");
            const heading = makeElement("div", "quotation-heading");
            heading.append(
                makeElement("h3", "quotation-reference", quotation.reference),
                makeElement("time", "quotation-date", `Received ${formatDate(quotation.createdAt)}`),
            );
            card.append(heading, makeElement("p", "quotation-channel", `Contact method: ${quotation.channel}`));
            const items = makeElement("ul", "quotation-items");
            for (const item of quotation.items) {
                items.append(makeElement("li", "", `${item.name} × ${item.quantity}`));
            }
            card.append(items);

            const controls = makeElement("div", "status-update");
            const statusLabel = makeElement("label", "", "Quotation status");
            const select = makeStatusSelect(quotationStatuses, quotation.status, `Status for ${quotation.reference}`);
            statusLabel.append(select);
            const saveButton = makeElement("button", "primary-button", "Save status");
            saveButton.type = "button";
            saveButton.addEventListener("click", async () => {
                await runAction(saveButton, async () => {
                    await requestJson(`/api/admin/quotations/${encodeURIComponent(quotation.reference)}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: select.value }),
                    });
                    setMessage(dashboardMessage, `Updated quotation ${quotation.reference}.`);
                    await loadQuotations();
                    await loadOverview();
                });
            });
            controls.append(statusLabel, saveButton);

            if (!quotation.orderReference) {
                const orderToggle = makeElement("button", "secondary-button", "Record as order");
                orderToggle.type = "button";
                const orderForm = makeElement("form", "order-from-quote");
                orderForm.hidden = true;
                const name = makeElement("input");
                name.required = true;
                name.maxLength = 120;
                name.placeholder = "Customer name";
                name.setAttribute("aria-label", "Customer name");
                const email = makeElement("input");
                email.type = "email";
                email.maxLength = 254;
                email.placeholder = "Email (optional if phone provided)";
                email.setAttribute("aria-label", "Customer email");
                const phone = makeElement("input");
                phone.type = "tel";
                phone.maxLength = 40;
                phone.placeholder = "Phone (optional if email provided)";
                phone.setAttribute("aria-label", "Customer phone");
                const total = makeElement("input");
                total.type = "number";
                total.min = "0";
                total.step = "0.01";
                total.placeholder = "Confirmed total (KES, optional)";
                total.setAttribute("aria-label", "Order total in KES");
                const submit = makeElement("button", "primary-button", "Create order");
                submit.type = "submit";
                orderForm.append(name, email, phone, total, submit);
                orderToggle.addEventListener("click", () => {
                    orderForm.hidden = !orderForm.hidden;
                });
                orderForm.addEventListener("submit", async (event) => {
                    event.preventDefault();
                    await runAction(submit, async () => {
                        const order = await requestJson(
                            `/api/admin/quotations/${encodeURIComponent(quotation.reference)}/order`,
                            {
                                method: "POST",
                                body: JSON.stringify({
                                    name: name.value,
                                    email: email.value,
                                    phone: phone.value,
                                    total: total.value,
                                }),
                            },
                        );
                        setMessage(dashboardMessage, `Created order ${order.reference}.`);
                        await loadQuotations();
                        await loadOverview();
                    });
                });
                controls.append(orderToggle);
                card.append(controls, orderForm);
            } else {
                controls.append(makeElement("span", "related-order", `Order: ${quotation.orderReference}`));
                card.append(controls);
            }
            list.append(card);
        }
    }

    async function loadOptions() {
        const result = await requestJson("/api/admin/options");
        const categories = result.categories.map((category) => ({ value: category.id, label: category.name }));
        setOptions(document.querySelector("#product-category"), categories, "Choose category");
        const images = result.images.map((image) => ({ value: image, label: image.replace(".jpg", "") }));
        setOptions(document.querySelector("#product-image"), images, "Choose photo");
    }

    function resetProductForm() {
        document.querySelector("#product-form").reset();
        document.querySelector("#product-original-id").value = "";
        document.querySelector("#product-id").disabled = false;
        document.querySelector("#product-form-title").textContent = "Add a product";
        document.querySelector("#product-cancel").hidden = true;
    }

    async function loadProducts() {
        const query = new URLSearchParams({ q: document.querySelector("#product-search").value.trim() });
        const result = await requestJson(`/api/admin/products?${query}`);
        const tbody = document.querySelector("#product-list");
        tbody.replaceChildren();
        for (const product of result.products) {
            const row = makeElement("tr");
            const productCell = makeElement("td");
            const image = makeElement("img", "table-thumbnail");
            image.src = product.image;
            image.alt = "";
            productCell.append(image, makeElement("strong", "", product.name), makeElement("small", "", product.id));
            row.append(productCell, makeElement("td", "", product.categoryName));
            row.append(makeElement("td", "", product.price === null ? "Price on request" : formatMoney(product.price)));
            row.append(makeElement("td", "", product.active ? "Active" : "Archived"));
            const actions = makeElement("td", "table-actions");
            if (product.active) {
                const edit = makeElement("button", "text-button", "Edit");
                edit.type = "button";
                edit.addEventListener("click", async () => {
                    await loadOptions();
                    document.querySelector("#product-original-id").value = product.id;
                    document.querySelector("#product-id").value = product.id;
                    document.querySelector("#product-id").disabled = true;
                    document.querySelector("#product-name").value = product.name;
                    document.querySelector("#product-description").value = product.description;
                    document.querySelector("#product-category").value = product.categoryId;
                    document.querySelector("#product-image").value = product.image.split("/").pop();
                    document.querySelector("#product-price").value = product.price ?? "";
                    document.querySelector("#product-form-title").textContent = `Edit ${product.name}`;
                    document.querySelector("#product-cancel").hidden = false;
                    document.querySelector("#product-name").focus();
                });
                const remove = makeElement("button", "danger-button", "Delete");
                remove.type = "button";
                remove.addEventListener("click", async () => {
                    if (!window.confirm(`Archive ${product.name}? Existing quotations keep their saved product details.`)) {
                        return;
                    }
                    await runAction(remove, async () => {
                        await requestJson(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
                        setMessage(dashboardMessage, `Archived ${product.name}.`);
                        await loadProducts();
                        await loadOverview();
                    });
                });
                actions.append(edit, remove);
            } else {
                actions.append(makeElement("span", "muted-text", "Archived"));
            }
            row.append(actions);
            tbody.append(row);
        }
        if (result.products.length === 0) {
            const row = makeElement("tr");
            const cell = makeElement("td", "empty-cell", "No products found.");
            cell.colSpan = 5;
            row.append(cell);
            tbody.append(row);
        }
    }

    async function loadCategories() {
        const result = await requestJson("/api/admin/categories");
        const tbody = document.querySelector("#category-list");
        tbody.replaceChildren();
        for (const category of result.categories) {
            const row = makeElement("tr");
            row.append(makeElement("td", "", category.name), makeElement("td", "", String(category.product_count)));
            const actions = makeElement("td", "table-actions");
            const edit = makeElement("button", "text-button", "Edit");
            edit.type = "button";
            edit.addEventListener("click", () => {
                document.querySelector("#category-id").value = category.id;
                document.querySelector("#category-name").value = category.name;
                document.querySelector("#category-form button[type='submit']").textContent = "Save category";
                document.querySelector("#category-cancel").hidden = false;
                document.querySelector("#category-name").focus();
            });
            const remove = makeElement("button", "danger-button", "Delete");
            remove.type = "button";
            remove.addEventListener("click", async () => {
                if (!window.confirm(`Delete category ${category.name}?`)) {
                    return;
                }
                await runAction(remove, async () => {
                    await requestJson(`/api/admin/categories/${encodeURIComponent(category.id)}`, { method: "DELETE" });
                    setMessage(dashboardMessage, `Deleted category ${category.name}.`);
                    await loadCategories();
                    await loadOptions();
                    await loadProducts();
                });
            });
            actions.append(edit, remove);
            row.append(actions);
            tbody.append(row);
        }
    }

    async function loadCustomers() {
        const query = new URLSearchParams({ q: document.querySelector("#customer-search").value.trim() });
        const result = await requestJson(`/api/admin/customers?${query}`);
        const tbody = document.querySelector("#customer-list");
        tbody.replaceChildren();
        for (const customer of result.customers) {
            const row = makeElement("tr");
            row.append(
                makeElement("td", "", customer.name),
                makeElement("td", "", customer.email || "—"),
                makeElement("td", "", customer.phone || "—"),
                makeElement("td", "", String(customer.order_count)),
                makeElement("td", "", formatDate(customer.last_order_at)),
            );
            tbody.append(row);
        }
        if (result.customers.length === 0) {
            const row = makeElement("tr");
            const cell = makeElement("td", "empty-cell", "No customer records yet.");
            cell.colSpan = 5;
            row.append(cell);
            tbody.append(row);
        }
    }

    async function loadOrders() {
        const query = new URLSearchParams({
            q: document.querySelector("#order-search").value.trim(),
            status: document.querySelector("#order-filter").value,
        });
        const result = await requestJson(`/api/admin/orders?${query}`);
        const list = document.querySelector("#order-list");
        list.replaceChildren();
        if (result.orders.length === 0) {
            list.append(makeElement("p", "empty-results", "No orders match this search."));
            return;
        }
        for (const order of result.orders) {
            const card = makeElement("article", "order-card");
            const heading = makeElement("div", "quotation-heading");
            heading.append(
                makeElement("h3", "quotation-reference", order.reference),
                makeElement("time", "quotation-date", formatDate(order.createdAt)),
            );
            card.append(heading, makeElement("p", "customer-name", order.customer.name));
            const contact = [order.customer.email, order.customer.phone].filter(Boolean).join(" · ") || "No contact details";
            card.append(makeElement("p", "quotation-channel", contact));
            if (order.quotationReference) {
                card.append(makeElement("p", "quotation-channel", `From quotation ${order.quotationReference}`));
            }
            const items = makeElement("ul", "quotation-items");
            for (const item of order.items) {
                items.append(makeElement("li", "", `${item.name} × ${item.quantity}`));
            }
            card.append(items);
            const controls = makeElement("div", "status-update");
            controls.append(makeElement("strong", "", `Total: ${formatMoney(order.total)}`));
            const select = makeStatusSelect(orderStatuses, order.status, `Status for order ${order.reference}`);
            const update = makeElement("button", "primary-button", "Update status");
            update.type = "button";
            update.addEventListener("click", async () => {
                await runAction(update, async () => {
                    await requestJson(`/api/admin/orders/${encodeURIComponent(order.reference)}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: select.value }),
                    });
                    setMessage(dashboardMessage, `Updated order ${order.reference}.`);
                    await loadOrders();
                    await loadOverview();
                });
            });
            controls.append(select, update);
            card.append(controls);
            list.append(card);
        }
    }

    async function runAction(button, action) {
        button.disabled = true;
        try {
            await action();
        } catch (error) {
            if (error.status === 401) {
                showLogin();
            }
            setMessage(dashboardMessage, error.message, true);
        } finally {
            button.disabled = false;
        }
    }

    async function loadView(view = activeView) {
        activeView = view;
        setMessage(dashboardMessage, "Loading...");
        try {
            if (view === "overview") await loadOverview();
            if (view === "quotations") await loadQuotations();
            if (view === "products") {
                await loadOptions();
                await loadProducts();
            }
            if (view === "categories") await loadCategories();
            if (view === "customers") await loadCustomers();
            if (view === "orders") await loadOrders();
            setMessage(dashboardMessage, "");
        } catch (error) {
            if (error.status === 401) showLogin();
            setMessage(dashboardMessage, error.message, true);
        }
    }

    function debounceLoad(view) {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => loadView(view), 250);
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = loginForm.querySelector("button[type='submit']");
        button.disabled = true;
        setMessage(loginMessage, "");
        try {
            await requestJson("/api/admin/login", {
                method: "POST",
                body: JSON.stringify({ password: passwordInput.value }),
            });
            passwordInput.value = "";
            showDashboard();
            await loadView("overview");
        } catch (error) {
            setMessage(loginMessage, error.message, true);
        } finally {
            button.disabled = false;
        }
    });

    document.querySelectorAll(".tab-button").forEach((button) => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".tab-button").forEach((tab) => tab.classList.toggle("is-active", tab === button));
            document.querySelectorAll(".dashboard-panel").forEach((panel) => {
                panel.hidden = panel.dataset.panel !== button.dataset.view;
            });
            loadView(button.dataset.view);
        });
    });

    document.querySelector("#logout-button").addEventListener("click", async () => {
        try {
            await requestJson("/api/admin/logout", { method: "POST", body: "{}" });
            showLogin();
        } catch (error) {
            setMessage(dashboardMessage, error.message, true);
        }
    });

    document.querySelector("#overview-refresh").addEventListener("click", () => loadView("overview"));
    document.querySelector("#quotation-refresh").addEventListener("click", () => loadView("quotations"));
    document.querySelector("#product-refresh").addEventListener("click", () => loadView("products"));
    document.querySelector("#customer-refresh").addEventListener("click", () => loadView("customers"));
    document.querySelector("#order-refresh").addEventListener("click", () => loadView("orders"));
    document.querySelector("#quotation-search").addEventListener("input", () => debounceLoad("quotations"));
    document.querySelector("#quotation-filter").addEventListener("change", () => loadView("quotations"));
    document.querySelector("#product-search").addEventListener("input", () => debounceLoad("products"));
    document.querySelector("#customer-search").addEventListener("input", () => debounceLoad("customers"));
    document.querySelector("#order-search").addEventListener("input", () => debounceLoad("orders"));
    document.querySelector("#order-filter").addEventListener("change", () => loadView("orders"));

    document.querySelector("#product-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector("button[type='submit']");
        await runAction(button, async () => {
            const originalId = document.querySelector("#product-original-id").value;
            const data = {
                id: document.querySelector("#product-id").value.trim(),
                name: document.querySelector("#product-name").value,
                description: document.querySelector("#product-description").value,
                categoryId: document.querySelector("#product-category").value,
                image: document.querySelector("#product-image").value,
                price: document.querySelector("#product-price").value,
            };
            const route = originalId
                ? `/api/admin/products/${encodeURIComponent(originalId)}`
                : "/api/admin/products";
            await requestJson(route, {
                method: originalId ? "PATCH" : "POST",
                body: JSON.stringify(data),
            });
            setMessage(dashboardMessage, originalId ? "Product updated." : "Product added.");
            resetProductForm();
            await loadProducts();
            await loadOverview();
        });
    });
    document.querySelector("#product-cancel").addEventListener("click", resetProductForm);

    document.querySelector("#category-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector("button[type='submit']");
        await runAction(button, async () => {
            const id = document.querySelector("#category-id").value;
            const name = document.querySelector("#category-name").value;
            await requestJson(id ? `/api/admin/categories/${encodeURIComponent(id)}` : "/api/admin/categories", {
                method: id ? "PATCH" : "POST",
                body: JSON.stringify({ name }),
            });
            form.reset();
            document.querySelector("#category-id").value = "";
            document.querySelector("#category-form button[type='submit']").textContent = "Add category";
            document.querySelector("#category-cancel").hidden = true;
            setMessage(dashboardMessage, id ? "Category updated." : "Category added.");
            await loadCategories();
            await loadOptions();
            await loadOverview();
        });
    });
    document.querySelector("#category-cancel").addEventListener("click", () => {
        document.querySelector("#category-form").reset();
        document.querySelector("#category-id").value = "";
        document.querySelector("#category-form button[type='submit']").textContent = "Add category";
        document.querySelector("#category-cancel").hidden = true;
    });

    requestJson("/api/admin/session")
        .then((result) => {
            if (!result.authenticated) {
                showLogin();
                return;
            }
            showDashboard();
            return loadView("overview");
        })
        .catch((error) => setMessage(loginMessage, error.message, true));
})();
