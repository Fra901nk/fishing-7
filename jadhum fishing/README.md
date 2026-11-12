# Jadhum Fishing Equipments

## Run locally

Node.js 22.5 or later is required. The server uses Node's built-in SQLite support and has no external package dependencies.

For local testing, the password can be `Admin` because the server binds only to this computer by default. In PowerShell, from this folder:

```powershell
$env:ADMIN_PASSWORD = "Admin"
npm.cmd start
```

Open the storefront at `http://localhost:3000` and the admin dashboard at `http://localhost:3000/admin`. The server creates `data/quotations.sqlite` on first run. Keep the `data` folder private and backed up; it is excluded from Git.

Quotation requests are saved when a customer clicks an email, WhatsApp, or SMS request link. Each request gets a unique reference before the message composer opens. Customers still need to send the prepared message themselves.

## Admin and deployment

The admin password is supplied through the `ADMIN_PASSWORD` environment variable. A short password is accepted only when the server binds to localhost; use a unique password of at least 12 characters before deployment. Admin sessions expire after eight hours. For an HTTPS deployment, bind the server to the host's required interface (often `HOST=0.0.0.0`), set `COOKIE_SECURE=1`, configure a persistent writable disk for the SQLite database, and set `DATABASE_PATH` to that disk's database file. Deploy to a Node.js host; opening `index.html` directly with `file://` does not provide database or admin API access.

At `/admin`, staff can:

- Add, edit, and archive products, including their descriptions, KES prices, and one of the bundled product photos.
- Add, rename, and delete empty categories.
- Search quotation requests, update their status, and record a confirmed request as an order.
- View customer records created from recorded orders, update order statuses, and review business activity and summary statistics.

Online checkout is not enabled. Orders are recorded by staff after the customer confirms by email, WhatsApp, or SMS. Product records are archived rather than permanently deleted so prior quotation history remains intact.
