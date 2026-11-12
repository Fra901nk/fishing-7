# Jadhum Fishing Equipments

## Run locally

Node.js 22.5 or later is required. The server uses Node's built-in SQLite support and has no external package dependencies.

For local testing, the server binds to `127.0.0.1` by default and the built-in fallback password is `Admin123456!` unless you set `ADMIN_PASSWORD`. In PowerShell, from this folder:

```powershell
$env:ADMIN_PASSWORD = "Admin"
npm.cmd start
```

Open the storefront at `http://localhost:3000` and the admin dashboard at `http://localhost:3000/admin`. The server creates `data/quotations.sqlite` on first run. Keep the `data` folder private and backed up; it is excluded from Git.

Quotation requests are saved when a customer clicks an email, WhatsApp, or SMS request link. Each request gets a unique reference before the message composer opens. Customers still need to send the prepared message themselves.

## Admin and deployment

The admin password is supplied through the `ADMIN_PASSWORD` environment variable. If it is not set, the app uses a fallback default while warning you to replace it in production. Use a unique password of at least 12 characters before deployment. Admin sessions expire after eight hours.

### Deploying to Vercel

The included `vercel.json` serves clean URLs such as `/admin`, and `api/[...path].js` adapts the app's API to Vercel Functions. In Vercel, set the project root to the folder containing `package.json` and `vercel.json`, and set a unique `ADMIN_PASSWORD` environment variable before deploying.

Important: Vercel's writable `/tmp` storage is temporary. The current SQLite database and in-memory admin sessions are not durable across function instances or restarts. This setup can make the app run on Vercel, but it is not suitable for retaining real quotations and orders; use a persistent external database before production. On a regular Node.js host, `DATABASE_PATH` can point to a persistent writable disk. Opening `index.html` directly with `file://` does not provide API access.

At `/admin`, staff can:

- Add, edit, and archive products, including their descriptions, KES prices, and one of the bundled product photos.
- Add, rename, and delete empty categories.
- Search quotation requests, update their status, and record a confirmed request as an order.
- View customer records created from recorded orders, update order statuses, and review business activity and summary statistics.

Online checkout is not enabled. Orders are recorded by staff after the customer confirms by email, WhatsApp, or SMS. Product records are archived rather than permanently deleted so prior quotation history remains intact.
