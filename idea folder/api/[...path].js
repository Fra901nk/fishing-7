"use strict";

const handleRequest = require("../server");

module.exports = (request, response) => {
    if (!request.url || !request.url.startsWith("/api/")) {
        const route = request.query && request.query.path;
        const segments = Array.isArray(route) ? route : route ? [route] : [];
        const queryIndex = request.url ? request.url.indexOf("?") : -1;
        const query = queryIndex === -1 ? "" : request.url.slice(queryIndex);
        request.url = `/api/${segments.join("/")}${query}`;
    }
    return handleRequest(request, response);
};
