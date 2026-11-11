export function makePdfRules(settings, viewer) {
  if (!settings.enabled || !settings.pdfEnabled) return [];
  const excludedRequestDomains = settings.excludedHosts.filter(host => !host.includes(":"));
  const common = { resourceTypes: ["main_frame", "sub_frame"], requestMethods: ["get"], ...(excludedRequestDomains.length ? { excludedRequestDomains } : {}) };
  const redirect = { type: "redirect", redirect: { regexSubstitution: `${viewer}?source:\\0` } };
  return [
    { id: 1, priority: 3, action: { type: "allow" }, condition: { ...common, urlFilter: "ink-original=1" } },
    { id: 2, priority: 2, action: redirect, condition: { ...common, regexFilter: "^file:///.*\\.pdf([?#].*)?$", isUrlFilterCaseSensitive: false } },
    { id: 3, priority: 1, action: redirect, condition: {
      ...common, regexFilter: "^https?://.*$", responseHeaders: [{ header: "content-type", values: ["application/pdf", "application/pdf;*"] }],
      excludedResponseHeaders: [{ header: "content-disposition", values: ["attachment*"] }]
    } }
  ];
}
