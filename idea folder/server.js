"use strict";

const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const { createServer } = require("node:http");
const { mkdir, readFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const configuredPassword = process.env.ADMIN_PASSWORD || "Admin123456!";
if (!process.env.ADMIN_PASSWORD) {
    console.warn("ADMIN_PASSWORD is not set. Using the built-in fallback password for deployment; set a unique ADMIN_PASSWORD in your deployment environment before production use.");
}
const adminPasswordHash = createHash("sha256").update(configuredPassword).digest();
const sessionCookieName = "jadhum_admin";
const sessionDurationMs = 8 * 60 * 60 * 1000;
const maxRequestBytes = 16 * 1024;
const quotationStatuses = new Set(["pending", "priced", "ordered", "closed"]);
const orderStatuses = new Set(["received", "processing", "completed", "cancelled"]);
const seedCategories = [
    ["rods", "Fishing Rods"],
    ["reels", "Fishing Reels"],
    ["line", "Fishing Line"],
    ["terminal-tackle", "Hooks & Terminal Tackle"],
    ["lures-bait", "Lures & Bait"],
    ["nets-gaffs", "Nets & Gaffs"],
    ["tackle-storage", "Tackle Storage"],
    ["floats-sinkers", "Floats & Sinkers"],
    ["apparel-waders", "Apparel & Waders"],
    ["electronics", "Fishing Electronics"],
    ["boating-safety", "Boating & Safety"],
    ["tools", "Fishing Tools"],
];
const seedProducts = [
    ["rods", "Fishing Rods", "Spinning, casting, surf, and travel rods for different waters and techniques.", "rods.jpg", "rods"],
    ["reels", "Fishing Reels", "Spinning, baitcasting, and fly reels to pair with your fishing rod.", "reels.jpg", "reels"],
    ["line", "Fishing Line", "Monofilament, braid, and fluorocarbon lines for a range of fishing conditions.", "line.jpg", "line"],
    ["hooks", "Hooks & Terminal Tackle", "Hooks, swivels, leaders, sinkers, and rigs for your tackle box.", "hooks.jpg", "terminal-tackle"],
    ["lures", "Lures & Bait", "Hard baits, soft plastics, spoons, jigs, and baiting essentials.", "lures.jpg", "lures-bait"],
    ["nets", "Nets & Gaffs", "Landing nets and fish-handling gear for bringing in your catch.", "nets.jpg", "nets-gaffs"],
    ["storage", "Tackle Storage", "Tackle boxes, utility trays, bags, and organizers for your gear.", "storage.jpg", "tackle-storage"],
    ["floats", "Floats & Sinkers", "Bobbers, floats, weights, and split shot for balanced presentations.", "floats.jpg", "floats-sinkers"],
    ["apparel", "Apparel & Waders", "Weather-ready clothing, boots, gloves, and waders for days outdoors.", "apparel.jpg", "apparel-waders"],
    ["electronics", "Fishing Electronics", "Fish finders, depth finders, and useful navigation accessories.", "electronics.jpg", "electronics"],
    ["boating", "Boating & Safety", "Life jackets, boat accessories, dry bags, and on-water essentials.", "boating.jpg", "boating-safety"],
    ["tools", "Fishing Tools", "Pliers, line cutters, scales, hook removers, and handy accessories.", "tools.jpg", "tools"],
];
const imageFiles = seedProducts.map((product) => product[3]);
const staticFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
    ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
    ["/admin", ["admin.html", "text/html; charset=utf-8"]],
    ["/admin.html", ["admin.html", "text/html; charset=utf-8"]],
    ["/admin.css", ["admin.css", "text/css; charset=utf-8"]],
    ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]],
]);

for (const image of imageFiles) {
    staticFiles.set(`/images/photos/${image}`, [`images/photos/${image}`, "image/jpeg"]);
}

const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);
if (configuredPassword.length < 12 && !localHosts.has(host)) {
    console.error("ADMIN_PASSWORD must be at least 12 characters when the server is exposed beyond this computer.");
    process.exit(1);
}
if (configuredPassword.length < 12) {
    console.warn("Warning: this short admin password is allowed only on localhost. Use a strong password before deployment.");
}
if (require.main === module && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    console.error("PORT must be a valid TCP port.");
    process.exit(1);
}

const configuredDatabasePath = process.env.DATABASE_PATH || (
    process.env.VERCEL
        ? path.join(os.tmpdir(), "jadhum-quotations.sqlite")
        : path.join("data", "quotations.sqlite")
);
const databasePath = path.isAbsolute(configuredDatabasePath)
    ? configuredDatabasePath
    : path.resolve(root, configuredDatabasePath);
const sessions = new Map();
const loginAttempts = new Map();
const quotationAttempts = new Map();

function createHttpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function sendJson(response, status, value, headers = {}) {
    response.writeHead(status, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        ...headers,
    });
    response.end(JSON.stringify(value));
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let tooLarge = false;

        request.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxRequestBytes) {
                tooLarge = true;
                return;
            }
            chunks.push(chunk);
        });
        request.on("end", () => {
            if (tooLarge) {
                reject(createHttpError(413, "Request body is too large."));
                return;
            }
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                if (!body || typeof body !== "object" || Array.isArray(body)) {
                    throw new Error("Expected an object.");
                }
                resolve(body);
            } catch {
                reject(createHttpError(400, "Request body must be valid JSON."));
            }
        });
        request.on("error", reject);
    });
}

function sessionToken(request) {
    const cookie = request.headers.cookie || "";
    const entry = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`));
    return entry ? entry.slice(sessionCookieName.length + 1) : "";
}

function authenticated(request) {
    const token = sessionToken(request);
    const session = sessions.get(token);
    if (!session) {
        return false;
    }
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return false;
    }
    return true;
}

function sessionCookie(value, request, maxAge) {
    const secure = process.env.COOKIE_SECURE === "1" || Boolean(request.socket.encrypted);
    return `${sessionCookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function isRateLimited(store, key, limit, windowMs) {
    const now = Date.now();
    const entry = store.get(key);
    if (!entry || entry.startsAt + windowMs <= now) {
        store.set(key, { startsAt: now, count: 0 });
        return false;
    }
    return entry.count >= limit;
}

function recordAttempt(store, key, windowMs) {
    const now = Date.now();
    const entry = store.get(key);
    if (!entry || entry.startsAt + windowMs <= now) {
        store.set(key, { startsAt: now, count: 1 });
        return;
    }
    entry.count += 1;
}

function validPassword(candidate) {
    const candidateHash = createHash("sha256").update(candidate).digest();
    return timingSafeEqual(candidateHash, adminPasswordHash);
}

function recordActivity(database, type, description, entity = "", entityId = "") {
    database.prepare(
        "INSERT INTO activity (created_at, type, description, entity, entity_id) VALUES (?, ?, ?, ?, ?)",
    ).run(new Date().toISOString(), type, description, entity, entityId);
}

function normalizeText(value, field, maxLength, { optional = false } = {}) {
    if (typeof value !== "string") {
        throw createHttpError(400, `${field} must be text.`);
    }
    const text = value.trim();
    if ((!optional && text.length === 0) || text.length > maxLength) {
        throw createHttpError(400, `${field} is required and must be at most ${maxLength} characters.`);
    }
    return text;
}

function validateProduct(database, body, existingId = "") {
    const id = existingId || normalizeText(body.id, "Product ID", 60);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
        throw createHttpError(400, "Product ID may use lowercase letters, numbers, and hyphens.");
    }
    const name = normalizeText(body.name, "Product name", 120);
    const description = normalizeText(body.description, "Product description", 500);
    const categoryId = normalizeText(body.categoryId, "Category", 60);
    if (!database.prepare("SELECT 1 FROM categories WHERE id = ?").get(categoryId)) {
        throw createHttpError(400, "Choose an existing product category.");
    }
    if (typeof body.image !== "string" || !imageFiles.includes(path.basename(body.image))) {
        throw createHttpError(400, "Choose an available product photo.");
    }
    let priceCents = null;
    if (body.price !== "" && body.price !== null && body.price !== undefined) {
        const price = Number(body.price);
        if (!Number.isFinite(price) || price < 0 || price > 100000000) {
            throw createHttpError(400, "Price must be a non-negative KES amount.");
        }
        priceCents = Math.round(price * 100);
    }
    return { id, name, description, categoryId, image: path.basename(body.image), priceCents };
}

function validateQuotation(database, body) {
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
        throw createHttpError(400, "Add at least one valid product to the quotation.");
    }
    if (!["email", "whatsapp", "sms"].includes(body.channel)) {
        throw createHttpError(400, "Choose a valid contact channel.");
    }

    const seen = new Set();
    const items = body.items.map((item) => {
        if (
            !item ||
            typeof item !== "object" ||
            typeof item.id !== "string" ||
            seen.has(item.id) ||
            !Number.isInteger(item.quantity) ||
            item.quantity < 1 ||
            item.quantity > 99
        ) {
            throw createHttpError(400, "The quotation contains an invalid product or quantity.");
        }
        const product = database.prepare("SELECT name, active FROM products WHERE id = ?").get(item.id);
        if (!product || !product.active) {
            throw createHttpError(400, "One of the selected products is no longer available.");
        }
        seen.add(item.id);
        return { id: item.id, name: product.name, quantity: item.quantity };
    });
    return { channel: body.channel, items };
}

function makeReference(database, createdAt, prefix = "JAD") {
    const datePart = createdAt.slice(0, 10).replaceAll("-", "");
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const reference = `${prefix}-${datePart}-${randomBytes(4).toString("hex").toUpperCase()}`;
        const exists = prefix === "JAD"
            ? database.prepare("SELECT 1 FROM quotations WHERE reference = ?").get(reference)
            : database.prepare("SELECT 1 FROM orders WHERE reference = ?").get(reference);
        if (!exists) {
            return reference;
        }
    }
    throw new Error("Could not generate a unique quotation reference.");
}

function formatQuotation(row) {
    return {
        reference: row.reference,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        channel: row.channel,
        status: row.status,
        orderReference: row.order_reference || null,
        items: JSON.parse(row.items_json),
    };
}

function formatProduct(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        image: `/images/photos/${row.image}`,
        price: row.price_cents === null ? null : row.price_cents / 100,
        categoryId: row.category_id,
        categoryName: row.category_name,
        active: Boolean(row.active),
    };
}

function formatOrder(row) {
    return {
        reference: row.reference,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        status: row.status,
        total: row.total_cents === null ? null : row.total_cents / 100,
        customer: { id: row.customer_id, name: row.customer_name, email: row.email, phone: row.phone },
        quotationReference: row.quotation_reference,
        items: JSON.parse(row.items_json),
    };
}

async function serveStatic(pathname, response) {
    const asset = staticFiles.get(pathname);
    if (!asset) {
        return false;
    }
    const [relativePath, contentType] = asset;
    const contents = await readFile(path.join(root, relativePath));
    response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Length": contents.length,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
    });
    response.end(contents);
    return true;
}

async function handleRequest(request, response, database) {
    const url = new URL(request.url, "http://localhost");
    const clientIp = request.socket.remoteAddress || "unknown";

    if (request.method === "GET" && url.pathname === "/api/products") {
        const rows = database.prepare(
            "SELECT p.id, p.name, p.description, p.image, p.price_cents, p.category_id, p.active, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE",
        ).all();
        sendJson(response, 200, { products: rows.map(formatProduct) });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/categories") {
        const categories = database.prepare(
            "SELECT id, name FROM categories ORDER BY name COLLATE NOCASE",
        ).all();
        sendJson(response, 200, { categories });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/quotations") {
        if (isRateLimited(quotationAttempts, clientIp, 30, 15 * 60 * 1000)) {
            sendJson(response, 429, { error: "Too many quotation requests. Please try again later." });
            return;
        }
        const body = await readJsonBody(request);
        const quotation = validateQuotation(database, body);
        const createdAt = new Date().toISOString();
        const reference = makeReference(database, createdAt);
        database.prepare(
            "INSERT INTO quotations (reference, created_at, updated_at, channel, status, items_json) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(reference, createdAt, createdAt, quotation.channel, "pending", JSON.stringify(quotation.items));
        quotationAttempts.set(clientIp, {
            startsAt: quotationAttempts.get(clientIp)?.startsAt || Date.now(),
            count: (quotationAttempts.get(clientIp)?.count || 0) + 1,
        });
        recordActivity(database, "quotation.created", `New price request received by ${quotation.channel}.`, "quotation", reference);
        sendJson(response, 201, { reference, createdAt, status: "pending" });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/login") {
        if (isRateLimited(loginAttempts, clientIp, 10, 15 * 60 * 1000)) {
            sendJson(response, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
            return;
        }
        const body = await readJsonBody(request);
        if (typeof body.password !== "string" || body.password.length > 256 || !validPassword(body.password)) {
            recordAttempt(loginAttempts, clientIp, 15 * 60 * 1000);
            sendJson(response, 401, { error: "Incorrect admin password." });
            return;
        }

        loginAttempts.delete(clientIp);
        const token = randomBytes(32).toString("hex");
        sessions.set(token, { expiresAt: Date.now() + sessionDurationMs });
        sendJson(response, 200, { authenticated: true }, {
            "Set-Cookie": sessionCookie(token, request, sessionDurationMs / 1000),
        });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/session") {
        sendJson(response, 200, { authenticated: authenticated(request) });
        return;
    }

    if (url.pathname.startsWith("/api/admin/")) {
        if (!authenticated(request)) {
            sendJson(response, 401, { error: "Admin sign-in is required." });
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/admin/overview") {
            const counts = database.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM products WHERE active = 1) AS products,
                    (SELECT COUNT(*) FROM categories) AS categories,
                    (SELECT COUNT(*) FROM customers) AS customers,
                    (SELECT COUNT(*) FROM orders) AS orders,
                    (SELECT COUNT(*) FROM orders WHERE status IN ('received', 'processing')) AS open_orders,
                    (SELECT COUNT(*) FROM quotations WHERE status = 'pending') AS pending_quotations,
                    (SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE status != 'cancelled') AS recorded_sales_cents
            `).get();
            const activity = database.prepare(
                "SELECT id, created_at, type, description, entity, entity_id FROM activity ORDER BY id DESC LIMIT 20",
            ).all();
            sendJson(response, 200, {
                stats: {
                    products: counts.products,
                    categories: counts.categories,
                    customers: counts.customers,
                    orders: counts.orders,
                    openOrders: counts.open_orders,
                    pendingQuotations: counts.pending_quotations,
                    recordedSales: counts.recorded_sales_cents / 100,
                },
                activity,
            });
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/admin/categories") {
            const categories = database.prepare(`
                SELECT c.id, c.name, COUNT(p.id) AS product_count
                FROM categories c LEFT JOIN products p ON p.category_id = c.id
                GROUP BY c.id ORDER BY c.name COLLATE NOCASE
            `).all();
            sendJson(response, 200, { categories });
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/admin/options") {
            const categories = database.prepare("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE").all();
            sendJson(response, 200, { categories, images: imageFiles });
            return;
        }

        if (request.method === "POST" && url.pathname === "/api/admin/categories") {
            const body = await readJsonBody(request);
            const name = normalizeText(body.name, "Category name", 80);
            const id = typeof body.id === "string" && body.id.trim()
                ? normalizeText(body.id, "Category ID", 60)
                : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
                throw createHttpError(400, "Category ID may use lowercase letters, numbers, and hyphens.");
            }
            if (database.prepare("SELECT 1 FROM categories WHERE id = ? OR name = ? COLLATE NOCASE").get(id, name)) {
                throw createHttpError(409, "A category with this ID or name already exists.");
            }
            database.prepare("INSERT INTO categories (id, name) VALUES (?, ?)").run(id, name);
            recordActivity(database, "category.created", `Added category ${name}.`, "category", id);
            sendJson(response, 201, { id, name });
            return;
        }

        const categoryMatch = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)$/);
        if ((request.method === "PATCH" || request.method === "DELETE") && categoryMatch) {
            const categoryId = decodeURIComponent(categoryMatch[1]);
            if (request.method === "PATCH") {
                const body = await readJsonBody(request);
                const name = normalizeText(body.name, "Category name", 80);
                if (database.prepare("SELECT 1 FROM categories WHERE id != ? AND name = ? COLLATE NOCASE").get(categoryId, name)) {
                    throw createHttpError(409, "A category with this name already exists.");
                }
                const result = database.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, categoryId);
                if (result.changes === 0) {
                    throw createHttpError(404, "Category was not found.");
                }
                recordActivity(database, "category.updated", `Updated category ${name}.`, "category", categoryId);
                sendJson(response, 200, { id: categoryId, name });
                return;
            }
            const category = database.prepare("SELECT name FROM categories WHERE id = ?").get(categoryId);
            if (!category) {
                throw createHttpError(404, "Category was not found.");
            }
            const usage = database.prepare("SELECT COUNT(*) AS count FROM products WHERE category_id = ?").get(categoryId);
            if (usage.count > 0) {
                throw createHttpError(409, "Move or remove this category's products before deleting it.");
            }
            database.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
            recordActivity(database, "category.deleted", `Deleted category ${category.name}.`, "category", categoryId);
            sendJson(response, 200, { id: categoryId });
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/admin/products") {
            const term = (url.searchParams.get("q") || "").trim().slice(0, 100);
            const rows = database.prepare(`
                SELECT p.id, p.name, p.description, p.image, p.price_cents, p.category_id, p.active, c.name AS category_name
                FROM products p JOIN categories c ON c.id = p.category_id
                WHERE p.name LIKE ? OR p.id LIKE ? OR c.name LIKE ?
                ORDER BY p.active DESC, p.name COLLATE NOCASE LIMIT 500
            `).all(`%${term}%`, `%${term}%`, `%${term}%`);
            sendJson(response, 200, { products: rows.map(formatProduct) });
            return;
        }

        if (request.method === "POST" && url.pathname === "/api/admin/products") {
            const body = await readJsonBody(request);
            const product = validateProduct(database, body);
            if (database.prepare("SELECT 1 FROM products WHERE id = ?").get(product.id)) {
                throw createHttpError(409, "A product with this ID already exists.");
            }
            const now = new Date().toISOString();
            database.prepare(`
                INSERT INTO products (id, name, description, image, price_cents, category_id, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            `).run(product.id, product.name, product.description, product.image, product.priceCents, product.categoryId, now, now);
            recordActivity(database, "product.created", `Added product ${product.name}.`, "product", product.id);
            sendJson(response, 201, { product: product });
            return;
        }

        const productMatch = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
        if ((request.method === "PATCH" || request.method === "DELETE") && productMatch) {
            const productId = decodeURIComponent(productMatch[1]);
            const previous = database.prepare("SELECT name FROM products WHERE id = ? AND active = 1").get(productId);
            if (!previous) {
                throw createHttpError(404, "Active product was not found.");
            }
            if (request.method === "PATCH") {
                const body = await readJsonBody(request);
                const product = validateProduct(database, body, productId);
                const now = new Date().toISOString();
                database.prepare(`
                    UPDATE products SET name = ?, description = ?, image = ?, price_cents = ?, category_id = ?, updated_at = ?
                    WHERE id = ?
                `).run(product.name, product.description, product.image, product.priceCents, product.categoryId, now, productId);
                recordActivity(database, "product.updated", `Updated product ${product.name}.`, "product", productId);
                sendJson(response, 200, { product: { ...product, id: productId } });
                return;
            }
            database.prepare("UPDATE products SET active = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), productId);
            recordActivity(database, "product.archived", `Archived product ${previous.name}.`, "product", productId);
            sendJson(response, 200, { id: productId, archived: true });
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/admin/quotations") {
            const term = (url.searchParams.get("q") || "").trim().slice(0, 100);
            const status = url.searchParams.get("status") || "all";
            if (status !== "all" && !quotationStatuses.has(status)) {
                sendJson(response, 400, { error: "Choose a valid quotation status." });
                return;
            }
            const pattern = `%${term}%`;
            const rows = status === "all"
                ? database.prepare(
                `SELECT q.reference, q.created_at, q.updated_at, q.channel, q.status, q.items_json,
                    (SELECT o.reference FROM orders o WHERE o.quotation_reference = q.reference) AS order_reference
                FROM quotations q WHERE q.reference LIKE ? OR q.items_json LIKE ? ORDER BY q.created_at DESC LIMIT 200`,
                ).all(pattern, pattern)
                : database.prepare(
                `SELECT q.reference, q.created_at, q.updated_at, q.channel, q.status, q.items_json,
                    (SELECT o.reference FROM orders o WHERE o.quotation_reference = q.reference) AS order_reference
                FROM quotations q WHERE q.status = ? AND (q.reference LIKE ? OR q.items_json LIKE ?) ORDER BY q.created_at DESC LIMIT 200`,
                ).all(status, pattern, pattern);
            sendJson(response, 200, { quotations: rows.map(formatQuotation) });
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/admin/customers") {
            const term = (url.searchParams.get("q") || "").trim().slice(0, 100);
            const pattern = `%${term}%`;
            const customers = database.prepare(`
                SELECT c.id, c.name, c.email, c.phone, c.created_at,
                    COUNT(o.reference) AS order_count,
                    MAX(o.created_at) AS last_order_at
                FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
                WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
                GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500
            `).all(pattern, pattern, pattern);
            sendJson(response, 200, { customers });
            return;
        }

        if (request.method === "GET" && url.pathname === "/api/admin/orders") {
            const term = (url.searchParams.get("q") || "").trim().slice(0, 100);
            const status = url.searchParams.get("status") || "all";
            if (status !== "all" && !orderStatuses.has(status)) {
                throw createHttpError(400, "Choose a valid order status.");
            }
            const pattern = `%${term}%`;
            const rows = status === "all"
                ? database.prepare(`
                    SELECT o.*, c.name AS customer_name, c.email, c.phone
                    FROM orders o JOIN customers c ON c.id = o.customer_id
                    WHERE o.reference LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?
                    ORDER BY o.created_at DESC LIMIT 200
                `).all(pattern, pattern, pattern, pattern)
                : database.prepare(`
                    SELECT o.*, c.name AS customer_name, c.email, c.phone
                    FROM orders o JOIN customers c ON c.id = o.customer_id
                    WHERE o.status = ? AND (o.reference LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)
                    ORDER BY o.created_at DESC LIMIT 200
                `).all(status, pattern, pattern, pattern, pattern);
            sendJson(response, 200, { orders: rows.map(formatOrder) });
            return;
        }

        if (request.method === "PATCH" && url.pathname.startsWith("/api/admin/orders/")) {
            const orderReference = decodeURIComponent(url.pathname.slice("/api/admin/orders/".length));
            const body = await readJsonBody(request);
            if (!orderStatuses.has(body.status)) {
                throw createHttpError(400, "Choose a valid order status.");
            }
            const updatedAt = new Date().toISOString();
            const result = database.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE reference = ?")
                .run(body.status, updatedAt, orderReference);
            if (result.changes === 0) {
                throw createHttpError(404, "Order was not found.");
            }
            recordActivity(database, "order.status", `Order ${orderReference} marked ${body.status}.`, "order", orderReference);
            sendJson(response, 200, { reference: orderReference, status: body.status, updatedAt });
            return;
        }

        const orderFromQuotationMatch = url.pathname.match(/^\/api\/admin\/quotations\/([^/]+)\/order$/);
        if (request.method === "POST" && orderFromQuotationMatch) {
            const quotationReference = decodeURIComponent(orderFromQuotationMatch[1]);
            const quotation = database.prepare("SELECT * FROM quotations WHERE reference = ?").get(quotationReference);
            if (!quotation) {
                throw createHttpError(404, "Quotation was not found.");
            }
            if (database.prepare("SELECT 1 FROM orders WHERE quotation_reference = ?").get(quotationReference)) {
                throw createHttpError(409, "An order has already been recorded for this quotation.");
            }
            const body = await readJsonBody(request);
            const name = normalizeText(body.name, "Customer name", 120);
            const email = normalizeText(body.email || "", "Customer email", 254, { optional: true }).toLowerCase();
            const phone = normalizeText(body.phone || "", "Customer phone", 40, { optional: true });
            if (!email && !phone) {
                throw createHttpError(400, "Enter at least a customer email address or phone number.");
            }
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw createHttpError(400, "Enter a valid customer email address.");
            }
            let totalCents = null;
            if (body.total !== "" && body.total !== null && body.total !== undefined) {
                const total = Number(body.total);
                if (!Number.isFinite(total) || total < 0 || total > 1000000000) {
                    throw createHttpError(400, "Order total must be a non-negative KES amount.");
                }
                totalCents = Math.round(total * 100);
            }

            const now = new Date().toISOString();
            let customer = email
                ? database.prepare("SELECT id FROM customers WHERE email = ?").get(email)
                : undefined;
            if (!customer && phone) {
                customer = database.prepare("SELECT id FROM customers WHERE phone = ?").get(phone);
            }
            let customerId;
            if (customer) {
                customerId = customer.id;
                database.prepare("UPDATE customers SET name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ?")
                    .run(name, email, phone, now, customerId);
            } else {
                customerId = Number(database.prepare(
                    "INSERT INTO customers (name, email, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                ).run(name, email, phone, now, now).lastInsertRowid);
            }
            const orderReference = makeReference(database, now, "ORD");
            database.prepare(`
                INSERT INTO orders (reference, customer_id, quotation_reference, items_json, status, total_cents, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'received', ?, ?, ?)
            `).run(orderReference, customerId, quotationReference, quotation.items_json, totalCents, now, now);
            database.prepare("UPDATE quotations SET status = 'ordered', updated_at = ? WHERE reference = ?")
                .run(now, quotationReference);
            recordActivity(database, "order.created", `Recorded order ${orderReference} for ${name}.`, "order", orderReference);
            recordActivity(database, "quotation.status", `Quotation ${quotationReference} converted to an order.`, "quotation", quotationReference);
            sendJson(response, 201, { reference: orderReference, quotationReference, status: "received" });
            return;
        }

        const quotationMatch = url.pathname.match(/^\/api\/admin\/quotations\/([^/]+)$/);
        if (request.method === "PATCH" && quotationMatch) {
            let reference;
            try {
                reference = decodeURIComponent(quotationMatch[1]);
            } catch {
                throw createHttpError(400, "Quotation reference is invalid.");
            }
            const body = await readJsonBody(request);
            if (!quotationStatuses.has(body.status)) {
                throw createHttpError(400, "Choose a valid quotation status.");
            }
            const updatedAt = new Date().toISOString();
            const result = database.prepare(
                "UPDATE quotations SET status = ?, updated_at = ? WHERE reference = ?",
            ).run(body.status, updatedAt, reference);
            if (result.changes === 0) {
                throw createHttpError(404, "Quotation was not found.");
            }
            recordActivity(database, "quotation.status", `Quotation ${reference} marked ${body.status}.`, "quotation", reference);
            sendJson(response, 200, { reference, status: body.status, updatedAt });
            return;
        }

        if (request.method === "POST" && url.pathname === "/api/admin/logout") {
            sessions.delete(sessionToken(request));
            sendJson(response, 200, { authenticated: false }, { "Set-Cookie": sessionCookie("", request, 0) });
            return;
        }

        sendJson(response, 404, { error: "Admin endpoint was not found." });
        return;
    }

    if (request.method === "GET" && await serveStatic(url.pathname, response)) {
        return;
    }
    sendJson(response, 404, { error: "Page or API route was not found." });
}

async function main({ serverless = false } = {}) {
    await mkdir(path.dirname(databasePath), { recursive: true });
    const database = new DatabaseSync(databasePath);
    database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS quotations (
            reference TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms')),
            status TEXT NOT NULL CHECK (status IN ('pending', 'priced', 'ordered', 'closed')),
            items_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            image TEXT NOT NULL,
            price_cents INTEGER,
            category_id TEXT NOT NULL REFERENCES categories(id),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS customers_email_idx ON customers (email);
        CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone);
        CREATE TABLE IF NOT EXISTS orders (
            reference TEXT PRIMARY KEY,
            customer_id INTEGER NOT NULL REFERENCES customers(id),
            quotation_reference TEXT UNIQUE REFERENCES quotations(reference),
            items_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('received', 'processing', 'completed', 'cancelled')),
            total_cents INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
        CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
        CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            type TEXT NOT NULL,
            description TEXT NOT NULL,
            entity TEXT NOT NULL DEFAULT '',
            entity_id TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS quotations_created_at_idx ON quotations (created_at DESC);
        CREATE INDEX IF NOT EXISTS quotations_status_idx ON quotations (status);
    `);
    const seedCategory = database.prepare("INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?)");
    for (const [id, name] of seedCategories) {
        seedCategory.run(id, name);
    }
    const seedProduct = database.prepare(`
        INSERT OR IGNORE INTO products (id, name, description, image, category_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const [id, name, description, image, categoryId] of seedProducts) {
        seedProduct.run(id, name, description, image, categoryId, now, now);
    }

    if (serverless) {
        return database;
    }

    const server = createServer((request, response) => {
        handleRequest(request, response, database).catch((error) => {
            if (response.headersSent) {
                response.destroy(error);
                return;
            }
            if (error.status && error.status < 500) {
                sendJson(response, error.status, { error: error.message });
                return;
            }
            console.error("Request failed.", error);
            sendJson(response, 500, { error: "The server could not complete the request." });
        });
    });

    server.listen(port, host, () => {
        console.log(`Jadhum Fishing Equipments is running at http://${host}:${port}`);
        console.log(`Quotation database: ${databasePath}`);
        console.log("Admin dashboard: /admin");
    });

    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            server.close(() => {
                database.close();
                process.exit(0);
            });
        });
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error("Server could not start.", error);
        process.exit(1);
    });
} else {
    let databasePromise;
    module.exports = (request, response) => {
        if (!databasePromise) {
            databasePromise = main({ serverless: true });
        }
        databasePromise
            .then((database) => handleRequest(request, response, database))
            .catch((error) => {
                if (response.headersSent) {
                    response.destroy(error);
                    return;
                }
                if (error.status && error.status < 500) {
                    sendJson(response, error.status, { error: error.message });
                    return;
                }
                console.error("Request failed.", error);
                sendJson(response, 500, { error: "The server could not complete the request." });
            });
    };
}
