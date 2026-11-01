// Dibuat otomatis dari src/api.mjs. Jangan diedit langsung.
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// dev/node_modules/@netlify/runtime-utils/dist/main.js
var getString = (input) => typeof input === "string" ? input : JSON.stringify(input);
var base64Decode = globalThis.Buffer ? (input) => Buffer.from(input, "base64").toString() : (input) => atob(input);
var base64Encode = globalThis.Buffer ? (input) => Buffer.from(getString(input)).toString("base64") : (input) => btoa(getString(input));
var getEnvironment = () => {
  const { Deno, Netlify, process: process2 } = globalThis;
  return Netlify?.env ?? Deno?.env ?? {
    delete: (key) => delete process2?.env[key],
    get: (key) => process2?.env[key],
    has: (key) => Boolean(process2?.env[key]),
    set: (key, value) => {
      if (process2?.env) {
        process2.env[key] = value;
      }
    },
    toObject: () => process2?.env ?? {}
  };
};

// dev/node_modules/@netlify/otel/dist/main.js
var GET_TRACER = "__netlify__getTracer";
var getTracer = (name, version) => {
  return globalThis[GET_TRACER]?.(name, version);
};
function withActiveSpan(tracer, name, optionsOrFn, contextOrFn, fn) {
  const func = typeof contextOrFn === "function" ? contextOrFn : typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!func) {
    throw new Error("function to execute with active span is missing");
  }
  if (!tracer) {
    return func();
  }
  return tracer.withActiveSpan(name, optionsOrFn, contextOrFn, func);
}

// dev/node_modules/@netlify/blobs/dist/chunk-SQCJ2S3G.js
var getEnvironmentContext = () => {
  const context = globalThis.netlifyBlobsContext || getEnvironment().get("NETLIFY_BLOBS_CONTEXT");
  if (typeof context !== "string" || !context) {
    return {};
  }
  const data = base64Decode(context);
  try {
    return JSON.parse(data);
  } catch {
  }
  return {};
};
var MissingBlobsEnvironmentError = class extends Error {
  constructor(requiredProperties) {
    super(
      `The environment has not been configured to use Netlify Blobs. To use it manually, supply the following properties when creating a store: ${requiredProperties.join(
        ", "
      )}`
    );
    this.name = "MissingBlobsEnvironmentError";
  }
};
var BASE64_PREFIX = "b64;";
var METADATA_HEADER_INTERNAL = "x-amz-meta-user";
var METADATA_HEADER_EXTERNAL = "netlify-blobs-metadata";
var METADATA_MAX_SIZE = 2 * 1024;
var encodeMetadata = (metadata) => {
  if (!metadata) {
    return null;
  }
  const encodedObject = base64Encode(JSON.stringify(metadata));
  const payload = `b64;${encodedObject}`;
  if (METADATA_HEADER_EXTERNAL.length + payload.length > METADATA_MAX_SIZE) {
    throw new Error("Metadata object exceeds the maximum size");
  }
  return payload;
};
var decodeMetadata = (header) => {
  if (!header?.startsWith(BASE64_PREFIX)) {
    return {};
  }
  const encodedData = header.slice(BASE64_PREFIX.length);
  const decodedData = base64Decode(encodedData);
  const metadata = JSON.parse(decodedData);
  return metadata;
};
var getMetadataFromResponse = (response) => {
  if (!response.headers) {
    return {};
  }
  const value = response.headers.get(METADATA_HEADER_EXTERNAL) || response.headers.get(METADATA_HEADER_INTERNAL);
  try {
    return decodeMetadata(value);
  } catch {
    throw new Error(
      "An internal error occurred while trying to retrieve the metadata for an entry. Please try updating to the latest version of the Netlify Blobs client."
    );
  }
};
var NF_ERROR = "x-nf-error";
var NF_REQUEST_ID = "x-nf-request-id";
var DEPLOY_STORE_PREFIX = "deploy:";
var SITE_STORE_PREFIX = "site:";
var isDeniedWrite = (res, { method, storeName }) => (res.status === 401 || res.status === 403) && (method === "put" || method === "delete") && storeName !== void 0 && !storeName.startsWith(DEPLOY_STORE_PREFIX);
var blobsErrorMessage = (res, context, responseBody) => {
  let details = res.headers.get(NF_ERROR) || `${res.status} status code`;
  if (res.headers.has(NF_REQUEST_ID)) {
    details += `, ID: ${res.headers.get(NF_REQUEST_ID)}`;
  }
  if (isDeniedWrite(res, context)) {
    const storeName = context.storeName?.startsWith(SITE_STORE_PREFIX) ? context.storeName.slice(SITE_STORE_PREFIX.length) : context.storeName;
    const summary = `Netlify Blobs could not write to store '${storeName}' (${details}).`;
    if (context.edgeAccess) {
      return summary;
    }
    return `${summary} Builds and build plugins can only write to deploy-specific stores: use 'getDeployStore' instead of 'getStore', or pass a 'token' with write access to the store. If this code is not running in a build, check that the token and site ID are valid. See https://docs.netlify.com/build/data-and-storage/netlify-blobs/#deploy-specific-stores`;
  }
  let message = `Netlify Blobs has generated an internal error (${details})`;
  if (!res.headers.get(NF_ERROR) && responseBody) {
    message += `: ${responseBody}`;
  }
  return message;
};
var BlobsInternalError = class extends Error {
  constructor(res, context = {}, responseBody) {
    super(blobsErrorMessage(res, context, responseBody));
    this.name = "BlobsInternalError";
    this.status = res.status;
    this.responseBody = responseBody;
  }
};
var createBlobsInternalError = async (res, context = {}) => {
  const responseBody = await res.clone().text().catch(() => void 0);
  return new BlobsInternalError(res, context, responseBody);
};
var discardBody = async (res) => {
  await res.body?.cancel().catch(() => {
  });
};
var collectIterator = async (iterator) => {
  const result = [];
  for await (const item of iterator) {
    result.push(item);
  }
  return result;
};
function withSpan(span, name, fn) {
  if (span) return fn(span);
  return withActiveSpan(getTracer(), name, (span2) => {
    return fn(span2);
  });
}
var BlobsConsistencyError = class extends Error {
  constructor() {
    super(
      `Netlify Blobs has failed to perform a read using strong consistency because the environment has not been configured with a 'uncachedEdgeURL' property`
    );
    this.name = "BlobsConsistencyError";
  }
};
var REGION_AUTO = "auto";
var regions = {
  "us-east-1": true,
  "us-east-2": true,
  "eu-central-1": true,
  "ap-southeast-1": true,
  "ap-southeast-2": true
};
var isValidRegion = (input) => Object.keys(regions).includes(input);
var InvalidBlobsRegionError = class extends Error {
  constructor(region) {
    super(
      `${region} is not a supported Netlify Blobs region. Supported values are: ${Object.keys(regions).join(", ")}.`
    );
    this.name = "InvalidBlobsRegionError";
  }
};
var DEFAULT_RETRY_DELAY = getEnvironment().get("NODE_ENV") === "test" ? 1 : 5e3;
var MIN_RETRY_DELAY = 1e3;
var MAX_RETRY = 5;
var RATE_LIMIT_HEADER = "X-RateLimit-Reset";
var fetchAndRetry = async (fetch, url, options, attemptsLeft = MAX_RETRY, getRetryUrl) => {
  try {
    const res = await fetch(url, options);
    const isRetryable = res.status === 429 || res.status >= 500 || getRetryUrl !== void 0 && res.status === 403;
    if (attemptsLeft > 0 && isRetryable) {
      await discardBody(res);
      const delay = getDelay(res.headers.get(RATE_LIMIT_HEADER));
      await sleep(delay);
      const retryUrl = getRetryUrl ? await getRetryUrl() : url;
      return fetchAndRetry(fetch, retryUrl, options, attemptsLeft - 1, getRetryUrl);
    }
    return res;
  } catch (error) {
    if (attemptsLeft === 0) {
      throw error;
    }
    const delay = getDelay();
    await sleep(delay);
    const retryUrl = getRetryUrl ? await getRetryUrl() : url;
    return fetchAndRetry(fetch, retryUrl, options, attemptsLeft - 1, getRetryUrl);
  }
};
var getDelay = (rateLimitReset) => {
  if (!rateLimitReset) {
    return DEFAULT_RETRY_DELAY;
  }
  return Math.max(Number(rateLimitReset) * 1e3 - Date.now(), MIN_RETRY_DELAY);
};
var sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
var SIGNED_URL_ACCEPT_HEADER = "application/json;type=signed-url";
var Client = class {
  /**
   * Whether requests reach Blobs through the edge rather than the API. Only
   * runtime environments are given an edge URL.
   */
  get edgeAccess() {
    return this.edgeURL !== void 0;
  }
  constructor({ apiURL, consistency, edgeURL, fetch, region, siteID, token, uncachedEdgeURL }) {
    this.apiURL = apiURL;
    this.consistency = consistency ?? "eventual";
    this.edgeURL = edgeURL;
    this.fetch = fetch ?? globalThis.fetch;
    this.region = region;
    this.siteID = siteID;
    this.token = token;
    this.uncachedEdgeURL = uncachedEdgeURL;
    if (!this.fetch) {
      throw new Error(
        "Netlify Blobs could not find a `fetch` client in the global scope. You can either update your runtime to a version that includes `fetch` (like Node.js 18.0.0 or above), or you can supply your own implementation using the `fetch` property."
      );
    }
  }
  async getFinalRequest({
    consistency: opConsistency,
    key,
    metadata,
    method,
    parameters = {},
    storeName
  }) {
    const encodedMetadata = encodeMetadata(metadata);
    const consistency = opConsistency ?? this.consistency;
    let urlPath = `/${this.siteID}`;
    if (storeName) {
      urlPath += `/${storeName}`;
    }
    if (key) {
      urlPath += `/${key}`;
    }
    if (this.edgeURL) {
      if (consistency === "strong" && !this.uncachedEdgeURL) {
        throw new BlobsConsistencyError();
      }
      const headers = {
        authorization: `Bearer ${this.token}`
      };
      if (encodedMetadata) {
        headers[METADATA_HEADER_INTERNAL] = encodedMetadata;
      }
      if (this.region) {
        urlPath = `/region:${this.region}${urlPath}`;
      }
      const url2 = new URL(urlPath, consistency === "strong" ? this.uncachedEdgeURL : this.edgeURL);
      for (const key2 in parameters) {
        url2.searchParams.set(key2, parameters[key2]);
      }
      return {
        headers,
        url: url2.toString()
      };
    }
    const apiHeaders = { authorization: `Bearer ${this.token}` };
    const url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL ?? "https://api.netlify.com");
    for (const key2 in parameters) {
      url.searchParams.set(key2, parameters[key2]);
    }
    if (this.region) {
      url.searchParams.set("region", this.region);
    }
    if (storeName === void 0 || key === void 0) {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    if (encodedMetadata) {
      apiHeaders[METADATA_HEADER_EXTERNAL] = encodedMetadata;
    }
    if (method === "head" || method === "delete") {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    const res = await this.fetch(url.toString(), {
      headers: { ...apiHeaders, accept: SIGNED_URL_ACCEPT_HEADER },
      method
    });
    if (res.status !== 200) {
      throw await createBlobsInternalError(res, { edgeAccess: this.edgeAccess, method, storeName });
    }
    const { url: signedURL } = await res.json();
    const userHeaders = encodedMetadata ? { [METADATA_HEADER_INTERNAL]: encodedMetadata } : void 0;
    return {
      headers: userHeaders,
      url: signedURL
    };
  }
  async makeRequest({
    body,
    conditions = {},
    consistency,
    headers: extraHeaders,
    key,
    metadata,
    method,
    parameters,
    storeName
  }) {
    const { headers: baseHeaders = {}, url } = await this.getFinalRequest({
      consistency,
      key,
      metadata,
      method,
      parameters,
      storeName
    });
    const headers = {
      ...baseHeaders,
      ...extraHeaders
    };
    if (method === "put") {
      headers["cache-control"] = "max-age=0, stale-while-revalidate=60";
    }
    if ("onlyIfMatch" in conditions && conditions.onlyIfMatch) {
      headers["if-match"] = conditions.onlyIfMatch;
    } else if ("onlyIfNew" in conditions && conditions.onlyIfNew) {
      headers["if-none-match"] = "*";
    }
    const options = {
      body,
      headers,
      method
    };
    if (body instanceof ReadableStream) {
      options.duplex = "half";
    }
    const usesSignedUrl = !this.edgeURL && key !== void 0 && storeName !== void 0 && method !== "head" && method !== "delete";
    let getRetryUrl;
    if (usesSignedUrl) {
      getRetryUrl = async () => {
        const finalRequest = await this.getFinalRequest({ consistency, key, metadata, method, parameters, storeName });
        return finalRequest.url;
      };
    }
    return fetchAndRetry(this.fetch, url, options, void 0, getRetryUrl);
  }
};
var getClientOptions = (options, contextOverride) => {
  const context = contextOverride ?? getEnvironmentContext();
  const siteID = context.siteID ?? options.siteID;
  const token = context.token ?? options.token;
  if (!siteID || !token) {
    throw new MissingBlobsEnvironmentError(["siteID", "token"]);
  }
  if (options.region !== void 0 && !isValidRegion(options.region)) {
    throw new InvalidBlobsRegionError(options.region);
  }
  const clientOptions = {
    apiURL: context.apiURL ?? options.apiURL,
    consistency: options.consistency,
    edgeURL: context.edgeURL ?? options.edgeURL,
    fetch: options.fetch,
    region: options.region,
    siteID,
    token,
    uncachedEdgeURL: context.uncachedEdgeURL ?? options.uncachedEdgeURL
  };
  return clientOptions;
};

// dev/node_modules/@netlify/blobs/dist/main.js
var LEGACY_STORE_INTERNAL_PREFIX = "netlify-internal/legacy-namespace/";
var STATUS_OK = 200;
var STATUS_PRE_CONDITION_FAILED = 412;
var Store = class _Store {
  constructor(options) {
    this.client = options.client;
    if ("deployID" in options) {
      _Store.validateDeployID(options.deployID);
      let name = DEPLOY_STORE_PREFIX + options.deployID;
      if (options.name) {
        name += `:${options.name}`;
      }
      this.name = name;
    } else if (options.name.startsWith(LEGACY_STORE_INTERNAL_PREFIX)) {
      const storeName = options.name.slice(LEGACY_STORE_INTERNAL_PREFIX.length);
      _Store.validateStoreName(storeName);
      this.name = storeName;
    } else {
      _Store.validateStoreName(options.name);
      this.name = SITE_STORE_PREFIX + options.name;
    }
  }
  async delete(key) {
    const res = await this.client.makeRequest({ key, method: "delete", storeName: this.name });
    await discardBody(res);
    if (![200, 204, 404].includes(res.status)) {
      throw new BlobsInternalError(res, {
        edgeAccess: this.client.edgeAccess,
        method: "delete",
        storeName: this.name
      });
    }
  }
  async deleteAll() {
    let totalDeletedBlobs = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await this.client.makeRequest({ method: "delete", storeName: this.name });
      if (res.status !== 200) {
        await discardBody(res);
        throw new BlobsInternalError(res, {
          edgeAccess: this.client.edgeAccess,
          method: "delete",
          storeName: this.name
        });
      }
      const data = await res.json();
      if (typeof data.blobs_deleted !== "number") {
        throw new BlobsInternalError(res);
      }
      totalDeletedBlobs += data.blobs_deleted;
      hasMore = typeof data.has_more === "boolean" && data.has_more;
    }
    return {
      deletedBlobs: totalDeletedBlobs
    };
  }
  async get(key, options) {
    return withSpan(options?.span, "blobs.get", async (span) => {
      const { consistency, type } = options ?? {};
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.type": type,
        "blobs.method": "GET",
        "blobs.consistency": consistency
      });
      const res = await this.client.makeRequest({
        consistency,
        key,
        method: "get",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        await discardBody(res);
        return null;
      }
      if (res.status !== 200) {
        await discardBody(res);
        throw new BlobsInternalError(res);
      }
      if (type === void 0 || type === "text") {
        return res.text();
      }
      if (type === "arrayBuffer") {
        return res.arrayBuffer();
      }
      if (type === "blob") {
        return res.blob();
      }
      if (type === "json") {
        return res.json();
      }
      if (type === "stream") {
        return res.body;
      }
      await discardBody(res);
      throw new BlobsInternalError(res);
    });
  }
  async getMetadata(key, options = {}) {
    return withSpan(options?.span, "blobs.getMetadata", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "HEAD",
        "blobs.consistency": options.consistency
      });
      const res = await this.client.makeRequest({
        consistency: options.consistency,
        key,
        method: "head",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const etag = res?.headers.get("etag") ?? void 0;
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag,
        metadata
      };
      return result;
    });
  }
  async getWithMetadata(key, options) {
    return withSpan(options?.span, "blobs.getWithMetadata", async (span) => {
      const { consistency, etag: requestETag, type } = options ?? {};
      const headers = requestETag ? { "if-none-match": requestETag } : void 0;
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "GET",
        "blobs.consistency": options?.consistency,
        "blobs.type": type,
        "blobs.request.etag": requestETag
      });
      const res = await this.client.makeRequest({
        consistency,
        headers,
        key,
        method: "get",
        storeName: this.name
      });
      const responseETag = res?.headers.get("etag") ?? void 0;
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.etag": responseETag,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        await discardBody(res);
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        await discardBody(res);
        throw new BlobsInternalError(res);
      }
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag: responseETag,
        metadata
      };
      if (res.status === 304 && requestETag) {
        return { data: null, ...result };
      }
      if (type === void 0 || type === "text") {
        return { data: await res.text(), ...result };
      }
      if (type === "arrayBuffer") {
        return { data: await res.arrayBuffer(), ...result };
      }
      if (type === "blob") {
        return { data: await res.blob(), ...result };
      }
      if (type === "json") {
        return { data: await res.json(), ...result };
      }
      if (type === "stream") {
        return { data: res.body, ...result };
      }
      await discardBody(res);
      throw new Error(`Invalid 'type' property: ${type}. Expected: arrayBuffer, blob, json, stream, or text.`);
    });
  }
  list(options = {}) {
    return withSpan(options.span, "blobs.list", (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.method": "GET",
        "blobs.list.paginate": options.paginate ?? false
      });
      const iterator = this.getListIterator(options);
      if (options.paginate) {
        return iterator;
      }
      return collectIterator(iterator).then(
        (items) => items.reduce(
          (acc, item) => ({
            blobs: [...acc.blobs, ...item.blobs],
            directories: [...acc.directories, ...item.directories]
          }),
          { blobs: [], directories: [] }
        )
      );
    });
  }
  async set(key, data, options = {}) {
    return withSpan(options.span, "blobs.set", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.size": typeof data == "string" ? data.length : data instanceof Blob ? data.size : data.byteLength,
        "blobs.data.type": typeof data == "string" ? "string" : data instanceof Blob ? "blob" : "arrayBuffer",
        "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const res = await this.client.makeRequest({
        conditions,
        body: data,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        await discardBody(res);
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        await discardBody(res);
        return {
          etag,
          modified: true
        };
      }
      throw await createBlobsInternalError(res, {
        edgeAccess: this.client.edgeAccess,
        method: "put",
        storeName: this.name
      });
    });
  }
  async setJSON(key, data, options = {}) {
    return withSpan(options.span, "blobs.setJSON", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.type": "json",
        "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const payload = JSON.stringify(data);
      const headers = {
        "content-type": "application/json"
      };
      const res = await this.client.makeRequest({
        conditions,
        body: payload,
        headers,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      await discardBody(res);
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw new BlobsInternalError(res, {
        edgeAccess: this.client.edgeAccess,
        method: "put",
        storeName: this.name
      });
    });
  }
  static formatListResultBlob(result) {
    if (!result.key) {
      return null;
    }
    return {
      etag: result.etag,
      key: result.key
    };
  }
  static getConditions(options) {
    if ("onlyIfMatch" in options && "onlyIfNew" in options) {
      throw new Error(
        `The 'onlyIfMatch' and 'onlyIfNew' options are mutually exclusive. Using 'onlyIfMatch' will make the write succeed only if there is an entry for the key with the given content, while 'onlyIfNew' will make the write succeed only if there is no entry for the key.`
      );
    }
    if ("onlyIfMatch" in options && options.onlyIfMatch) {
      if (typeof options.onlyIfMatch !== "string") {
        throw new Error(`The 'onlyIfMatch' property expects a string representing an ETag.`);
      }
      return {
        onlyIfMatch: options.onlyIfMatch
      };
    }
    if ("onlyIfNew" in options && options.onlyIfNew) {
      if (typeof options.onlyIfNew !== "boolean") {
        throw new Error(
          `The 'onlyIfNew' property expects a boolean indicating whether the write should fail if an entry for the key already exists.`
        );
      }
      return {
        onlyIfNew: true
      };
    }
  }
  static validateKey(key) {
    if (key === "") {
      throw new Error("Blob key must not be empty.");
    }
    if (key.startsWith("/") || key.startsWith("%2F")) {
      throw new Error("Blob key must not start with forward slash (/).");
    }
    if (new TextEncoder().encode(key).length > 600) {
      throw new Error(
        "Blob key must be a sequence of Unicode characters whose UTF-8 encoding is at most 600 bytes long."
      );
    }
  }
  static validateDeployID(deployID) {
    if (!/^\w{1,24}$/.test(deployID)) {
      throw new Error(`'${deployID}' is not a valid Netlify deploy ID.`);
    }
  }
  static validateStoreName(name) {
    if (name.includes("/") || name.includes("%2F")) {
      throw new Error("Store name must not contain forward slashes (/).");
    }
    if (new TextEncoder().encode(name).length > 64) {
      throw new Error(
        "Store name must be a sequence of Unicode characters whose UTF-8 encoding is at most 64 bytes long."
      );
    }
  }
  getListIterator(options) {
    const { client, name: storeName } = this;
    const parameters = {};
    if (options?.prefix) {
      parameters.prefix = options.prefix;
    }
    if (options?.directories) {
      parameters.directories = "true";
    }
    return {
      [Symbol.asyncIterator]() {
        let currentCursor = null;
        let done = false;
        return {
          async next() {
            return withSpan(options?.span, "blobs.list.next", async (span) => {
              span?.setAttributes({
                "blobs.store": storeName,
                "blobs.method": "GET",
                "blobs.list.paginate": options?.paginate ?? false,
                "blobs.list.done": done,
                "blobs.list.cursor": currentCursor ?? void 0
              });
              if (done) {
                return { done: true, value: void 0 };
              }
              const nextParameters = { ...parameters };
              if (currentCursor !== null) {
                nextParameters.cursor = currentCursor;
              }
              const res = await client.makeRequest({
                method: "get",
                parameters: nextParameters,
                storeName
              });
              span?.setAttributes({
                "blobs.response.status": res.status
              });
              let blobs = [];
              let directories = [];
              if (![200, 204, 404].includes(res.status)) {
                await discardBody(res);
                throw new BlobsInternalError(res);
              }
              if (res.status === 404) {
                await discardBody(res);
                done = true;
              } else {
                const page = await res.json();
                if (page.next_cursor) {
                  currentCursor = page.next_cursor;
                } else {
                  done = true;
                }
                blobs = (page.blobs ?? []).map(_Store.formatListResultBlob).filter(Boolean);
                directories = page.directories ?? [];
              }
              return {
                done: false,
                value: {
                  blobs,
                  directories
                }
              };
            });
          }
        };
      }
    };
  }
};
var getDeployStoreRegion = (clientOptions, context) => {
  if (clientOptions.region) {
    return clientOptions.region;
  }
  if (clientOptions.edgeURL || clientOptions.uncachedEdgeURL) {
    if (!context.primaryRegion) {
      throw new Error(
        "When accessing a deploy store, the Netlify Blobs client needs to be configured with a region, and one was not found in the environment. To manually set the region, set the `region` property in the store options. If you are using the Netlify CLI, you may have an outdated version; run `npm install -g netlify-cli@latest` to update and try again."
      );
    }
    return context.primaryRegion;
  }
  return REGION_AUTO;
};
var getStore = (input, options) => {
  if (typeof input === "string") {
    const contextOverride = options?.siteID && options?.token ? { siteID: options?.siteID, token: options?.token } : void 0;
    const clientOptions = getClientOptions(options ?? {}, contextOverride);
    const client = new Client(clientOptions);
    return new Store({ client, name: input });
  }
  if (typeof input?.name === "string") {
    const { name } = input;
    const contextOverride = input?.siteID && input?.token ? { siteID: input?.siteID, token: input?.token } : void 0;
    const clientOptions = getClientOptions(input, contextOverride);
    if (!name) {
      throw new MissingBlobsEnvironmentError(["name"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, name });
  }
  if (typeof input?.deployID === "string") {
    const context = getEnvironmentContext();
    const clientOptions = getClientOptions(input, context);
    const { deployID } = input;
    if (!deployID) {
      throw new MissingBlobsEnvironmentError(["deployID"]);
    }
    clientOptions.region = getDeployStoreRegion(clientOptions, context);
    const client = new Client(clientOptions);
    return new Store({ client, deployID });
  }
  throw new Error(
    "The `getStore` method requires the name of the store as a string or as the `name` property of an options object"
  );
};

// src/api.mjs
import { scryptSync, randomBytes, createHmac, timingSafeEqual, createHash } from "node:crypto";

// public/tables.js
var TABLES = [
  { "id": "G1", "area": "Garden & Panggung", "seats": 4, "x": 36.08, "y": 54.12 },
  { "id": "G2", "area": "Garden & Panggung", "seats": 4, "x": 27.47, "y": 17.57 },
  { "id": "G3", "area": "Garden & Panggung", "seats": 4, "x": 30.84, "y": 17.57 },
  { "id": "G4", "area": "Garden & Panggung", "seats": 4, "x": 34.22, "y": 17.57 },
  { "id": "R1", "area": "Sawah", "seats": 4, "x": 35.73, "y": 66.78 },
  { "id": "R2", "area": "Sawah", "seats": 4, "x": 25.76, "y": 62.11 },
  { "id": "R3", "area": "Riverside", "seats": 4, "x": 10.11, "y": 85.01 },
  { "id": "R4", "area": "Riverside", "seats": 4, "x": 22.5, "y": 85.01 },
  { "id": "R5", "area": "Riverside", "seats": 4, "x": 33, "y": 85.04, "gazebo": true },
  { "id": "R6", "area": "Riverside", "seats": 4, "x": 36.37, "y": 85.04, "gazebo": true },
  { "id": "R7", "area": "Riverside", "seats": 4, "x": 49.53, "y": 85.04, "gazebo": true },
  { "id": "R8", "area": "Riverside", "seats": 4, "x": 70.09, "y": 85.01 },
  { "id": "R9", "area": "Riverside", "seats": 4, "x": 84.43, "y": 85.01 },
  { "id": "R10", "area": "Riverside", "seats": 4, "x": 89.11, "y": 85.01 },
  { "id": "PR1", "area": "Pelataran", "seats": 4, "x": 70.73, "y": 59.86 },
  { "id": "PR2", "area": "Pelataran", "seats": 4, "x": 66.32, "y": 59.86 },
  { "id": "PR3", "area": "Pelataran", "seats": 4, "x": 61.92, "y": 59.86 },
  { "id": "PR4", "area": "Pelataran", "seats": 4, "x": 59.28, "y": 43.05 },
  { "id": "PR5", "area": "Pelataran", "seats": 4, "x": 66.11, "y": 43.05 },
  { "id": "PR6", "area": "Pelataran", "seats": 4, "x": 70.63, "y": 43.05 },
  { "id": "PL2", "area": "Pelataran Limasan", "seats": 4, "x": 76.15, "y": 34.38 },
  { "id": "PL3", "area": "Pelataran Limasan", "seats": 4, "x": 80.36, "y": 34.38 },
  { "id": "PL4", "area": "Pelataran Limasan", "seats": 4, "x": 71.41, "y": 33.94 },
  { "id": "PL5", "area": "Pelataran Limasan", "seats": 4, "x": 70.75, "y": 29.6 },
  { "id": "PL6", "area": "Pelataran Limasan", "seats": 4, "x": 70.73, "y": 20.1 },
  { "id": "PL7", "area": "Pelataran Limasan", "seats": 4, "x": 70.75, "y": 15.05 },
  { "id": "PL8", "area": "Pelataran Limasan", "seats": 4, "x": 66.11, "y": 25.7 },
  { "id": "PL9", "area": "Pelataran Limasan", "seats": 4, "x": 57.92, "y": 17.57 },
  { "id": "PL10", "area": "Pelataran Limasan", "seats": 4, "x": 61.7, "y": 29.6 },
  { "id": "PL11", "area": "Pelataran Limasan", "seats": 4, "x": 56.83, "y": 29.6 },
  { "id": "L1", "area": "Joglo Limasan", "seats": 4, "x": 75.37, "y": 28.2 },
  { "id": "L2", "area": "Joglo Limasan", "seats": 4, "x": 75.39, "y": 20.37 },
  { "id": "L3", "area": "Joglo Limasan", "seats": 4, "x": 78.8, "y": 28.2 },
  { "id": "L4", "area": "Joglo Limasan", "seats": 4, "x": 82.24, "y": 24.27 },
  { "id": "L5", "area": "Joglo Limasan", "seats": 4, "x": 78.8, "y": 20.37 },
  { "id": "L6", "area": "Joglo Limasan", "seats": 4, "x": 82.24, "y": 16.31 },
  { "id": "L7", "area": "Joglo Limasan", "seats": 4, "x": 78.82, "y": 12.52 },
  { "id": "P1", "area": "Joglo Pakudusan", "seats": 4, "x": 76.92, "y": 60.13 },
  { "id": "P2", "area": "Joglo Pakudusan", "seats": 4, "x": 76.92, "y": 45.03 },
  { "id": "P3", "area": "Joglo Pakudusan", "seats": 4, "x": 80.4, "y": 52.28 },
  { "id": "P4", "area": "Joglo Pakudusan", "seats": 4, "x": 83.89, "y": 45.03 },
  { "id": "P5", "area": "Joglo Pakudusan", "seats": 4, "x": 83.89, "y": 60.13 }
];

// src/api.mjs
var tableList = (cfg) => Array.isArray(cfg?.tables) && cfg.tables.length ? cfg.tables : TABLES;
var num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
var normTable = (t) => ({
  id: t.id,
  area: clean(t.area, 40) || "Lainnya",
  seats: Math.min(40, Math.max(1, Math.round(num(t.seats, 4)))),
  x: Math.round(Math.min(99, Math.max(1, num(t.x, 50))) * 100) / 100,
  y: Math.round(Math.min(99, Math.max(1, num(t.y, 50))) * 100) / 100,
  ...t.gazebo ? { gazebo: true } : {}
});
var WIB = 7 * 3600 * 1e3;
var day = (ms = Date.now()) => new Date(ms + WIB).toISOString().slice(0, 10);
var store = () => getStore({ name: "kaly-denah", consistency: "strong" });
var json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
var Fail = class extends Error {
  constructor(msg, status = 400) {
    super(msg);
    this.status = status;
  }
};
var fail = (msg, status) => {
  throw new Fail(msg, status);
};
var hashPin = (pin, salt = randomBytes(16).toString("hex")) => ({ salt, hash: scryptSync(String(pin), salt, 32).toString("hex") });
var pinOk = (pin, h) => {
  if (!h) return false;
  const a = scryptSync(String(pin), h.salt, 32), b = Buffer.from(h.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};
var validPin = (p) => /^\d{4,8}$/.test(String(p || ""));
var b64 = (s) => Buffer.from(s).toString("base64url");
var sign = (cfg, body) => createHmac("sha256", cfg.secret).update(body).digest("base64url");
function makeToken(cfg, role) {
  const body = b64(JSON.stringify({ r: role, v: cfg.tokenVer, e: Date.now() + 90 * 864e5 }));
  return body + "." + sign(cfg, body);
}
function readToken(cfg, req) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [body, sig] = t.split(".");
  if (!body || !sig) return null;
  const good = sign(cfg, body);
  if (good.length !== sig.length || !timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.v === cfg.tokenVer && p.e > Date.now() ? p.r : null;
  } catch {
    return null;
  }
}
async function getConfig(s) {
  return s.get("config", { type: "json" });
}
var clean = (x, n = 200) => String(x ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
var publicCfg = (c) => ({ staff: c.staff || [], pollSec: c.pollSec || 30, longMin: c.longMin || 120, tables: Array.isArray(c.tables) && c.tables.length ? c.tables : null });
async function readVisit(s, key) {
  const r = await s.getWithMetadata(key, { type: "json" });
  return r ? { data: r.data, etag: r.etag } : null;
}
async function updateVisit(s, key, fn) {
  for (let i = 0; i < 6; i++) {
    const cur = await readVisit(s, key);
    if (!cur) fail("Data kunjungan tidak ditemukan. Muat ulang halaman.", 404);
    const next = fn(structuredClone(cur.data));
    if (!next) return cur;
    next.updatedAt = Date.now();
    const r = await s.setJSON(key, next, { onlyIfMatch: cur.etag });
    if (r.modified) return { data: next, etag: r.etag };
  }
  fail("Data sedang diubah dari perangkat lain. Coba lagi.", 409);
}
async function lockTables(s, ids, key) {
  const done = [];
  for (const id of ids) {
    const mk = "t/" + id;
    let r = await s.setJSON(mk, { visit: key, at: Date.now() }, { onlyIfNew: true });
    if (!r.modified) {
      const m = await s.getWithMetadata(mk, { type: "json" });
      const v = m?.data?.visit && await readVisit(s, m.data.visit);
      if (m && (!v || v.data.leftAt)) r = await s.setJSON(mk, { visit: key, at: Date.now() }, { onlyIfMatch: m.etag });
    }
    if (!r.modified) {
      await unlockTables(s, done, key);
      fail(`Meja ${id} sedang terisi. Muat ulang denah.`, 409);
    }
    done.push(id);
  }
}
async function unlockTables(s, ids, key) {
  await Promise.all(ids.map(async (id) => {
    const m = await s.getWithMetadata("t/" + id, { type: "json" });
    if (m && m.data?.visit === key) await s.delete("t/" + id);
  }));
}
var tablesOf = (v) => [v.table, ...v.join || []];
function checkTables(cfg, table, join) {
  const ids = [table, ...join || []].map((x) => clean(x, 8).toUpperCase());
  const known = new Set(tableList(cfg).map((t) => t.id));
  if (!ids.every((x) => known.has(x))) fail("Meja tidak dikenal");
  if (new Set(ids).size !== ids.length) fail("Meja dobel");
  return ids;
}
var timeOk = (ms, now = Date.now()) => Number.isFinite(ms) && ms > now - 36 * 36e5 && ms < now + 10 * 6e4;
async function dayVisits(s, d) {
  const { blobs } = await s.list({ prefix: `v/${d}/` });
  const sig = createHash("sha1").update(blobs.map((b) => b.key + b.etag).sort().join("|")).digest("hex");
  const past = d < day();
  if (past) {
    const snap = await s.get("snap/" + d, { type: "json" });
    if (snap && snap.sig === sig) return snap.visits;
  }
  const visits = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
  visits.sort((a, b) => a.arriveAt - b.arriveAt);
  if (past) await s.setJSON("snap/" + d, { sig, visits });
  return visits;
}
var fmtT = (ms) => ms ? new Date(ms + WIB).toISOString().slice(11, 16) : "";
var csvCell = (x) => {
  const v = String(x ?? "");
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
function toCsv(rows, cfg) {
  const AREA = Object.fromEntries(tableList(cfg).map((t) => [t.id, t.area]));
  const head = ["Tanggal", "Meja", "Meja gabungan", "Area", "Jumlah tamu", "Nama / keterangan", "Datang", "Pulang", "Lama duduk (menit)", "Dicatat oleh", "Dipulangkan oleh", "Catatan"];
  const lines = rows.map((v) => [
    v.day,
    v.table,
    (v.join || []).join(" + "),
    AREA[v.table] || "",
    v.pax,
    v.name,
    fmtT(v.arriveAt),
    fmtT(v.leftAt),
    v.leftAt ? Math.round((v.leftAt - v.arriveAt) / 6e4) : "",
    v.arriveBy,
    v.leftBy || "",
    (v.notes || []).map((n) => `${fmtT(n.at)} ${n.by ? n.by + ": " : ""}${n.text}`).join(" | ")
  ]);
  return "\uFEFFsep=;\r\n" + [head, ...lines].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}
async function handle(req, context) {
  const s = store();
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const cfg = await getConfig(s);
  if (path === "hello") return json({ setup: !!cfg, now: Date.now(), today: day() });
  if (path === "setup") {
    if (cfg) fail("Aplikasi sudah disiapkan. Masuk dengan PIN.", 403);
    if (!validPin(body.pinStaff) || !validPin(body.pinAdmin)) fail("PIN harus 4 sampai 8 angka");
    if (String(body.pinStaff) === String(body.pinAdmin)) fail("PIN staf dan PIN admin harus berbeda");
    const staff = [...new Set((body.staff || []).map((x) => clean(x, 40)).filter(Boolean))].slice(0, 60);
    const c = { v: 1, pinStaff: hashPin(body.pinStaff), pinAdmin: hashPin(body.pinAdmin), secret: randomBytes(32).toString("hex"), tokenVer: 1, staff, pollSec: 30, longMin: 120, createdAt: Date.now() };
    const r = await s.setJSON("config", c, { onlyIfNew: true });
    if (!r.modified) fail("Aplikasi sudah disiapkan dari perangkat lain. Masuk dengan PIN.", 409);
    return json({ token: makeToken(c, "admin"), role: "admin", cfg: publicCfg(c) });
  }
  if (!cfg) fail("Aplikasi belum disiapkan", 428);
  if (path === "login") {
    const ip = createHash("sha1").update(String(context?.ip || "x")).digest("hex").slice(0, 16);
    const lk = await s.get("lock/" + ip, { type: "json" });
    if (lk && lk.until > Date.now()) fail(`Terlalu banyak PIN salah. Coba lagi ${Math.ceil((lk.until - Date.now()) / 6e4)} menit lagi.`, 429);
    const pin = String(body.pin || "");
    const emergency = String(globalThis.Netlify?.env?.get?.("DENAH_ADMIN_PIN") ?? process.env.DENAH_ADMIN_PIN ?? "");
    const role2 = pinOk(pin, cfg.pinAdmin) || validPin(emergency) && pin.length === emergency.length && timingSafeEqual(Buffer.from(pin), Buffer.from(emergency)) ? "admin" : pinOk(pin, cfg.pinStaff) ? "staff" : null;
    if (!role2) {
      const fails = (lk && Date.now() - lk.at < 15 * 6e4 ? lk.fails : 0) + 1;
      await s.setJSON("lock/" + ip, { fails, at: Date.now(), until: fails >= 5 ? Date.now() + 10 * 6e4 : 0 });
      fail(fails >= 5 ? "PIN salah 5 kali. Tunggu 10 menit." : "PIN salah", 401);
    }
    if (lk) await s.delete("lock/" + ip);
    return json({ token: makeToken(cfg, role2), role: role2, cfg: publicCfg(cfg) });
  }
  const role = readToken(cfg, req);
  if (!role) fail("Sesi habis. Masuk lagi dengan PIN.", 401);
  const admin = role === "admin";
  const by = clean(body.by, 40);
  switch (path) {
    case "me":
      return json({ role, cfg: publicCfg(cfg), now: Date.now(), today: day() });
    // Sinkron: kunjungan hari ini & kemarin. Perangkat mengirim etag yang sudah dimilikinya, server hanya mengirim yang berubah.
    case "sync": {
      const known = body.known && typeof body.known === "object" ? body.known : {};
      const days = [day(), day(Date.now() - 864e5)];
      const lists = await Promise.all(days.map((d) => s.list({ prefix: `v/${d}/` })));
      const blobs = lists.flatMap((l) => l.blobs);
      const changed = {};
      await Promise.all(blobs.filter((b) => known[b.key] !== b.etag).map(async (b) => {
        const data = await s.get(b.key, { type: "json" });
        if (data) changed[b.key] = { data, etag: b.etag };
      }));
      return json({ now: Date.now(), today: days[0], keys: blobs.map((b) => b.key), changed, cfg: publicCfg(cfg), role });
    }
    case "arrive": {
      const ids = checkTables(cfg, body.table, body.join);
      const pax = Math.round(Number(body.pax));
      if (!(pax >= 1 && pax <= 200)) fail("Jumlah tamu 1 sampai 200");
      const at = body.at ? Number(body.at) : Date.now();
      if (!timeOk(at)) fail("Jam datang tidak valid");
      const d = day(at);
      const id = Date.now().toString(36) + randomBytes(3).toString("hex");
      const key = `v/${d}/${id}`;
      await lockTables(s, ids, key);
      const v = {
        id,
        key,
        day: d,
        table: ids[0],
        join: ids.slice(1),
        pax,
        name: clean(body.name, 80),
        arriveAt: at,
        arriveBy: by,
        leftAt: null,
        leftBy: "",
        notes: clean(body.note, 300) ? [{ at: Date.now(), by, text: clean(body.note, 300) }] : [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const r = await s.setJSON(key, v, { onlyIfNew: true });
      return json({ key, etag: r.etag, data: v });
    }
    case "note": {
      const text = clean(body.text, 300);
      if (!text) fail("Catatan masih kosong");
      const r = await updateVisit(s, body.key, (v) => {
        v.notes = [...v.notes || [], { at: Date.now(), by, text }].slice(-50);
        return v;
      });
      return json({ key: body.key, ...r });
    }
    case "note-del": {
      const r = await updateVisit(s, body.key, (v) => {
        v.notes = (v.notes || []).filter((n) => n.at !== Number(body.at));
        return v;
      });
      return json({ key: body.key, ...r });
    }
    case "edit": {
      const p = body.patch || {};
      const r = await updateVisit(s, body.key, (v) => {
        if (v.leftAt && !admin && v.day < day()) fail("Kunjungan hari sebelumnya hanya bisa diubah admin", 403);
        if (p.pax != null) {
          const n = Math.round(Number(p.pax));
          if (!(n >= 1 && n <= 200)) fail("Jumlah tamu 1 sampai 200");
          v.pax = n;
        }
        if (p.name != null) v.name = clean(p.name, 80);
        if (p.arriveAt != null) {
          const t = Number(p.arriveAt);
          if (!timeOk(t) && !admin) fail("Jam datang tidak valid");
          if (v.leftAt && t > v.leftAt) fail("Jam datang harus sebelum jam pulang");
          v.arriveAt = t;
        }
        if (p.leftAt != null && v.leftAt) {
          const t = Number(p.leftAt);
          if (t < v.arriveAt) fail("Jam pulang harus sesudah jam datang");
          v.leftAt = t;
        }
        return v;
      });
      return json({ key: body.key, ...r });
    }
    case "move": {
      const cur = await readVisit(s, body.key);
      if (!cur || cur.data.leftAt) fail("Tamu ini sudah pulang", 409);
      const ids = checkTables(cfg, body.table, body.join);
      const old = tablesOf(cur.data);
      const add = ids.filter((x) => !old.includes(x)), drop = old.filter((x) => !ids.includes(x));
      await lockTables(s, add, body.key);
      const r = await updateVisit(s, body.key, (v) => {
        v.table = ids[0];
        v.join = ids.slice(1);
        return v;
      });
      await unlockTables(s, drop, body.key);
      return json({ key: body.key, ...r });
    }
    case "leave": {
      const at = body.at ? Number(body.at) : Date.now();
      const note = clean(body.note, 300);
      const r = await updateVisit(s, body.key, (v) => {
        if (v.leftAt) return null;
        if (!(at >= v.arriveAt - 6e4) || at > Date.now() + 10 * 6e4) fail("Jam pulang harus sesudah jam datang");
        v.leftAt = Math.max(at, v.arriveAt);
        v.leftBy = by;
        if (note) v.notes = [...v.notes || [], { at: Date.now(), by, text: note }];
        return v;
      });
      await unlockTables(s, tablesOf(r.data), body.key);
      return json({ key: body.key, ...r });
    }
    // Batalkan "tamu pulang" yang salah tekan (meja harus masih kosong)
    case "reopen": {
      const cur = await readVisit(s, body.key);
      if (!cur || !cur.data.leftAt) fail("Kunjungan ini belum pulang");
      if (!admin && Date.now() - cur.data.leftAt > 3 * 36e5) fail("Hanya bisa dibatalkan dalam 3 jam. Minta admin.", 403);
      await lockTables(s, tablesOf(cur.data), body.key);
      const r = await updateVisit(s, body.key, (v) => {
        v.leftAt = null;
        v.leftBy = "";
        return v;
      });
      return json({ key: body.key, ...r });
    }
    case "delete": {
      if (!admin) fail("Menghapus data hanya bisa dengan PIN admin", 403);
      const cur = await readVisit(s, body.key);
      if (cur) {
        await unlockTables(s, tablesOf(cur.data), body.key);
        await s.delete(body.key);
      }
      return json({ key: body.key, deleted: true });
    }
    case "day": {
      const d = String(url.searchParams.get("d") || body.d || day());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail("Tanggal tidak valid");
      return json({ day: d, visits: await dayVisits(s, d) });
    }
    case "export": {
      const from = String(url.searchParams.get("from") || ""), to = String(url.searchParams.get("to") || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) fail("Rentang tanggal tidak valid");
      const days = [];
      for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
      if (days.length > 62) fail("Maksimal 62 hari sekali ekspor");
      const rows = (await Promise.all(days.map((d) => dayVisits(s, d)))).flat();
      return new Response(toCsv(rows, cfg), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="tamu-kaly-${from}_${to}.csv"`, "cache-control": "no-store" } });
    }
    // Atur meja (PIN admin): tambah, ubah (area, kursi, gazebo, posisi), hapus
    case "tables": {
      if (!admin) fail("Mengatur meja hanya bisa dengan PIN admin", 403);
      const t = body.table || {};
      const id = clean(t.id, 8).toUpperCase().replace(/\s+/g, "");
      for (let i = 0; i < 6; i++) {
        const cur = await s.getWithMetadata("config", { type: "json" });
        let list = structuredClone(tableList(cur.data));
        if (body.op === "add") {
          if (!/^[A-Z0-9-]{1,6}$/.test(id)) fail("Kode meja 1 sampai 6 huruf/angka, mis. PR7");
          if (list.some((x) => x.id === id)) fail(`Kode meja ${id} sudah dipakai`);
          if (list.length >= 200) fail("Maksimal 200 meja");
          list.push(normTable({ ...t, id }));
        } else if (body.op === "update") {
          const j = list.findIndex((x) => x.id === id);
          if (j < 0) fail("Meja tidak ditemukan. Muat ulang denah.", 404);
          const p = {};
          for (const k of ["area", "seats", "x", "y", "gazebo"]) if (t[k] !== void 0) p[k] = t[k];
          list[j] = normTable({ ...list[j], ...p, id });
        } else if (body.op === "remove") {
          if (!list.some((x) => x.id === id)) fail("Meja tidak ditemukan. Muat ulang denah.", 404);
          const m = await s.get("t/" + id, { type: "json" });
          const v = m?.visit && await readVisit(s, m.visit);
          if (v && !v.data.leftAt) fail(`Meja ${id} sedang terisi tamu. Pulangkan tamu dulu.`, 409);
          list = list.filter((x) => x.id !== id);
          if (!list.length) fail("Minimal harus ada satu meja");
        } else fail("Perintah tidak dikenal");
        const next = { ...cur.data, tables: list };
        const r = await s.setJSON("config", next, { onlyIfMatch: cur.etag });
        if (r.modified) return json({ cfg: publicCfg(next) });
      }
      fail("Pengaturan sedang diubah dari perangkat lain. Coba lagi.", 409);
    }
    case "config": {
      if (!admin) fail("Pengaturan hanya bisa dengan PIN admin", 403);
      const c = { ...cfg };
      if (Array.isArray(body.staff)) c.staff = [...new Set(body.staff.map((x) => clean(x, 40)).filter(Boolean))].slice(0, 60);
      if (body.pollSec != null) c.pollSec = [10, 15, 20, 30, 60].includes(Number(body.pollSec)) ? Number(body.pollSec) : 30;
      if (body.longMin != null) c.longMin = Math.min(600, Math.max(30, Math.round(Number(body.longMin) || 120)));
      const ps = body.pinStaff ? String(body.pinStaff) : "", pa = body.pinAdmin ? String(body.pinAdmin) : "";
      if (ps && !validPin(ps)) fail("PIN staf harus 4 sampai 8 angka");
      if (pa && !validPin(pa)) fail("PIN admin harus 4 sampai 8 angka");
      if (ps && pa && ps === pa || ps && !pa && pinOk(ps, cfg.pinAdmin) || pa && !ps && pinOk(pa, cfg.pinStaff)) fail("PIN staf dan PIN admin harus berbeda");
      if (ps) c.pinStaff = hashPin(ps);
      if (pa) c.pinAdmin = hashPin(pa);
      if (body.logoutAll) c.tokenVer = (c.tokenVer || 1) + 1;
      await s.setJSON("config", c);
      return json({ cfg: publicCfg(c), token: body.logoutAll ? makeToken(c, "admin") : void 0 });
    }
  }
  fail("Alamat tidak dikenal", 404);
}
var api_default = async (req, context) => {
  try {
    return await handle(req, context);
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Server sedang bermasalah. Coba lagi sebentar." }, 500);
  }
};
var config = { path: "/api/*" };
export {
  config,
  api_default as default
};
