import { VercelRequest, VercelResponse } from "@vercel/node";
import { composeCreatePullRequest } from "octokit-plugin-create-pull-request";
import { octokit, registry } from "../clients";
import { v4 as uuid } from "uuid";
import AdmZip from "adm-zip";
import axios from "axios";
import { AppConfig } from "@mfe-frameworks/config";

const REPO = { owner: "marcelovicentegc", repo: "microfrontend-framework" };
const ALLOWED_PATHS = ["components/", "pages/api/", "pages/"] as const;
const FORBIDDEN_ENTRIES = ["/_app.tsx"];
const RELATIVE_IMPORT_PATHS = ["../components/"];
const ENTRY_POINTS = {
  ITEMS: "[ITEMS ENTRY-POINT]",
  REWRITES: "[REWRITES ENTRY-POINT]",
};
const EXAMPLES_BASE_PATH = "nextjs-build-time-integration/examples";

type AllowedPaths = typeof ALLOWED_PATHS[number];

function updateRelativeImports(
  rawData: string,
  parentFolder: AllowedPaths,
  app: string
) {
  let data = rawData;

  if (parentFolder === "pages/") {
    RELATIVE_IMPORT_PATHS.forEach((path) => {
      data = data.replace(path, `../../${path}${app}/`);
    });
  }

  return data;
}

async function getAppData(
  data: { downloadUrl: string; appConfigDownloadUrl: string },
  app: string,
  tenant: string
) {
  const [appDownload, appConfigDownload] = await Promise.all([
    axios({
      url: data.downloadUrl,
      method: "GET",
      responseType: "arraybuffer",
    }),
    axios({
      url: data.appConfigDownloadUrl,
      method: "GET",
      responseType: "json",
    }),
  ]);

  const zip = new AdmZip(appDownload.data);
  const entries = zip.getEntries();

  const jsonRepresentation: any = {};

  for (const entry of entries) {
    const { entryName, getDataAsync, isDirectory } = entry;

    if (isDirectory) {
      continue;
    }

    await new Promise(function (resolve, reject) {
      try {
        getDataAsync(function (data) {
          const pathIndex = ALLOWED_PATHS.findIndex((path) =>
            entryName.includes(path)
          );
          if (
            pathIndex > -1 &&
            !FORBIDDEN_ENTRIES.find((entry) => entryName.includes(entry))
          ) {
            const parentFolder = ALLOWED_PATHS[pathIndex];
            const customPath = entryName.replace(
              parentFolder,
              `${parentFolder}${app}/`
            );

            const srcCode = updateRelativeImports(
              data.toString("utf-8"),
              parentFolder,
              app
            );

            jsonRepresentation[
              `${EXAMPLES_BASE_PATH}/${tenant}/${customPath}`
            ] = srcCode;
          }

          resolve(1);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  return {
    appJsonRepresentation: jsonRepresentation,
    appConfig: appConfigDownload.data as string,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end("Method Not Allowed");

    return res;
  }

  const {
    data: { app, tenant },
  } = req.body;

  const { data } = await registry.get(`/app?name=${app}`);

  const { appJsonRepresentation, appConfig } = await getAppData(
    data,
    app,
    tenant
  );

  // Validate `appConfig` before manipulating it into the tenant
  const appConfigObj = JSON.parse(
    appConfig
      .replace('import { AppConfig } from "@mfe-frameworks/config";', "")
      .replace("export default ", "")
      .replace(" as AppConfig;", "")
      .replace(/(\r\n|\n|\r)/gm, "")
      .replace("basePath: ", '"basePath": ')
      .replace(/items: /g, '"items": ')
      .replace(/route: /g, '"route": ')
      .replace(/pageName: /g, '"pageName": ')
      .replace(/title: /g, '"title": ')
      .replace(/\s+/g, "")
      .replace(/],}/g, "]}")
      .replace(/,}/g, "}")
      .replace(/},]/g, "}]")
  ) as AppConfig;

  const [tenantNextConfig, tenantConfig] = await Promise.all([
    octokit.rest.repos.getContent({
      ...REPO,
      path: `${EXAMPLES_BASE_PATH}/${tenant}/next.config.js`,
    }),
    octokit.rest.repos.getContent({
      ...REPO,
      path: `${EXAMPLES_BASE_PATH}/${tenant}/mf-config.ts`,
    }),
  ]);

  let nextConfigContent = Buffer.from(
    // @ts-ignore
    tenantNextConfig.data["content"],
    "base64"
  ).toString("ascii");

  let tenantConfigContent = Buffer.from(
    // @ts-ignore
    tenantConfig.data["content"],
    "base64"
  ).toString("ascii");

  tenantConfigContent = tenantConfigContent.replace(
    ENTRY_POINTS.ITEMS,
    ENTRY_POINTS.ITEMS +
      `\n${appConfigObj.items.map(
        (item) =>
          `{ route: "${appConfigObj.basePath}${item.route}", title: "${item.title}", pageName: "${item.pageName}"}`
      )}`
  );

  nextConfigContent = nextConfigContent.replace(
    ENTRY_POINTS.REWRITES,
    ENTRY_POINTS.REWRITES +
      `\n{ source: "${appConfigObj.basePath}/:path*",\n destination: "/${app}/:path*", },`
  );

  const files = {
    ...appJsonRepresentation,
    [`${EXAMPLES_BASE_PATH}/${tenant}/next.config.js`]: nextConfigContent,
    [`${EXAMPLES_BASE_PATH}/${tenant}/mf-config.ts`]: tenantConfigContent,
  };

  try {
    const response = await composeCreatePullRequest(octokit, {
      ...REPO,
      title: `Install ${app} on ${tenant}`,
      body: `# THIS IS AN AUTOMATED PULL REQUEST.\n This pull request addresses:\n - App ${app} installion on tenant ${tenant}. \n\n> Note that we're creating PRs just for the sake of keeping this repository clean. On a real-world application, the merge should be automated, once human review of app updates for possibly thousands of tenants wouldn't be humanly possible.`,
      base: "main",
      // UUID here is to prevent from throwing an error in case
      // the head branch exists.
      head: `${tenant}-${uuid()}`,
      changes: [
        {
          files,
          commit: `chore(tenant:${tenant}): install ${app}`,
        },
      ],
    });

    if (!response) {
      res.status(502).end("Bad Gateway");

      return res;
    }

    res.setHeader("Content-Type", "application/json");
    res.status(201).json({
      message: `Pull request #${response.data.number} successfully created. Visit it at ${response.data.html_url}`,
    });
  } catch (error) {
    throw error;
  }

  return res;
}
