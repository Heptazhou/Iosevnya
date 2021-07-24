"use strict";

const path = require("path");
const fs = require("fs-extra");
const semver = require("semver");
const execMain = require("../shared/execMain");

const ChangeFileDir = path.join(__dirname, "../../changes");
const PackageJsonPath = path.join(__dirname, "../../package.json");

execMain(main);

///////////////////////////////////////////////////////////////////////////////////////////////////

async function main() {
	const version = await GetLatestVersion();
	const packageJson = await fs.readJson(PackageJsonPath);
	packageJson.version = version;
	await fs.writeJson(PackageJsonPath, packageJson, { spaces: 2 });
}

async function GetLatestVersion() {
	const changeFiles = await fs.readdir(ChangeFileDir);
	const versions = new Set();
	for (const file of changeFiles) {
		const filePath = path.join(ChangeFileDir, file);
		const fileParts = path.parse(filePath);
		if (fileParts.ext !== ".md") continue;
		if (!semver.valid(fileParts.name)) continue;
		versions.add(fileParts.name);
	}
	const sortedVersions = Array.from(versions).sort((a, b) => semver.compare(b, a));
	return sortedVersions[0];
}
