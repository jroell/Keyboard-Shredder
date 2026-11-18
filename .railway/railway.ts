import { defineRailway, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const keyboardShredderVolume = volume("keyboard-shredder-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 5000 });
  const keyboardShredder = service("keyboard-shredder", {
    build: { buildEnvironment: "V3" },
    healthcheck: "/healthz",
    healthcheckTimeout: 60,
    replicas: { "sfo": 1 },
    domains: [{ domain: "shredder.jasonroell.com", port: 3000 }],
    volumeMounts: { "/app/data": keyboardShredderVolume },
  });

  return project("Keyboard Shredder", {
    variables: { managed: false },
    resources: [keyboardShredder, keyboardShredderVolume],
  });
});
