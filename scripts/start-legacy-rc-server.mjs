import { ProductionDeploymentError } from "./start-production-gateway.mjs";
import {
  isMainEntry,
  startLegacyRcServer
} from "./start-release-candidate-server.mjs";

if (isMainEntry(import.meta.url)) {
  try {
    await startLegacyRcServer();
  } catch (error) {
    const message = error instanceof ProductionDeploymentError
      ? error.message
      : "RC WebUI 서버를 시작하지 못했습니다.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
