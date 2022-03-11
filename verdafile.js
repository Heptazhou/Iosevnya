"use strict";

const fs = require("fs");
const build = require("verda").create();
const which = require("which");
const Path = require("path");
const toml = require("@iarna/toml");
const semver = require("semver");

///////////////////////////////////////////////////////////

const { task, file, oracle, computed, phony } = build.ruleTypes;
const { de, fu, sfu, ofu } = build.rules;
const { run, node, cd, cp, rm, fail, echo, silently } = build.actions;
const { FileList } = build.predefinedFuncs;

module.exports = build;

///////////////////////////////////////////////////////////

const BUILD = ".build";
const DIST = "dist";
const SNAPSHOT_TMP = ".build/snapshot";
const DIST_SUPER_TTC = "dist/.super-ttc";
const ARCHIVE_DIR = "release-archives";

const PATEL_C = ["node", "node_modules/patel/bin/patel-c"];
const TTCIZE = ["node", "node_modules/otb-ttc-bundle/bin/otb-ttc-bundle"];

const defaultWebFontFormats = ["ttf", "woff2"];
const webfontFormatsFast = ["ttf"];
const webfontFormatsPages = ["woff2"];

const WIDTH_NORMAL = "normal";
const WEIGHT_NORMAL = "regular";
const SLOPE_NORMAL = "upright";
const DEFAULT_SUBFAMILY = "regular";

const BUILD_PLANS = "build-plans.toml";
const PRIVATE_BUILD_PLANS = "private-build-plans.toml";

// Save journal to build/
build.setJournal(`${BUILD}/.verda-build-journal`);
// Enable self-tracking
build.setSelfTracking();

///////////////////////////////////////////////////////////
//////                   Oracles                     //////
///////////////////////////////////////////////////////////

const Version = computed(`env::version`, async target => {
	const [pjf] = await target.need(sfu`package.json`);
	const pj = JSON.parse(await fs.promises.readFile(pjf.full, "utf-8"));
	return pj.version;
});

const CheckTtfAutoHintExists = oracle(`oracle:check-ttfautohint-exists`, async target => {
	try {
		return await which("ttfautohint");
	} catch (e) {
		fail("External dependency <ttfautohint>, needed for building hinted font, does not exist.");
	}
});

const Dependencies = computed("env::dependencies", async target => {
	const [pjf] = await target.need(sfu`package.json`);
	const pj = JSON.parse(await fs.promises.readFile(pjf.full, "utf-8"));
	let subGoals = [];
	for (const pkgName in pj.dependencies) {
		subGoals.push(InstalledVersion(pkgName, pj.dependencies[pkgName]));
	}
	const [actual] = await target.need(subGoals);
	return actual;
});

const InstalledVersion = computed.make(
	(pkg, required) => `env::installed-version::${pkg}::${required}`,
	async (target, pkg, required) => {
		const [pj] = await target.need(sfu(`node_modules/${pkg}/package.json`));
		const depPkg = JSON.parse(await fs.promises.readFile(pj.full));
		if (!semver.satisfies(depPkg.version, required)) {
			fail(
				`Package version for ${pkg} is outdated:`,
				`Required ${required}, Installed ${depPkg.version}`
			);
		}
		return { name: pkg, actual: depPkg.version, required };
	}
);

///////////////////////////////////////////////////////////
//////                    Plans                      //////
///////////////////////////////////////////////////////////

const RawPlans = computed(`metadata:raw-plans`, async target => {
	await target.need(sfu(BUILD_PLANS), ofu(PRIVATE_BUILD_PLANS), Version);

	const bp = await tryParseToml(BUILD_PLANS);
	bp.buildOptions = bp.buildOptions || {};

	if (fs.existsSync(PRIVATE_BUILD_PLANS)) {
		const privateBP = await tryParseToml(PRIVATE_BUILD_PLANS);
		Object.assign(bp.buildPlans, privateBP.buildPlans || {});
		Object.assign(bp.collectPlans, privateBP.collectPlans || {});
		Object.assign(bp.buildOptions, privateBP.buildOptions || {});
	}
	return bp;
});
async function tryParseToml(str) {
	try {
		return JSON.parse(JSON.stringify(toml.parse(fs.readFileSync(str, "utf-8"))));
	} catch (e) {
		throw new Error(
			`Failed to parse configuration file ${str}.\n` +
				`Please validate whether there's syntax error.\n` +
				`${e}`
		);
	}
}

const BuildPlans = computed("metadata:build-plans", async target => {
	const [rp] = await target.need(RawPlans);
	const rawBuildPlans = rp.buildPlans;

	const returnBuildPlans = {};
	const fileNameToBpMap = {};
	for (const prefix in rawBuildPlans) {
		const bp = { ...rawBuildPlans[prefix] };
		validateAndShimBuildPlans(prefix, bp, rp.weights, rp.slopes, rp.widths);
		bp.webfontFormats = bp["webfont-formats"] || defaultWebFontFormats;
		bp.targets = [];
		const weights = bp.weights,
			slopes = bp.slopes,
			widths = bp.widths;
		const suffixMapping = getSuffixMapping(weights, slopes, widths);
		for (const suffix in suffixMapping) {
			const sfi = suffixMapping[suffix];
			if (weights && !weights[sfi.weight]) continue;
			if (slopes && !slopes[sfi.slope]) continue;
			const fileName = makeFileName(prefix, suffix);
			bp.targets.push(fileName);
			fileNameToBpMap[fileName] = { prefix, suffix };
		}
		returnBuildPlans[prefix] = bp;
	}
	return { fileNameToBpMap, buildPlans: returnBuildPlans };
});

const BuildPlanOf = computed.group("metadata:build-plan-of", async (target, gid) => {
	const [{ buildPlans }] = await target.need(BuildPlans);
	const plan = buildPlans[gid];
	if (!plan) fail(`Build plan for '${gid}' not found.` + whyBuildPlanIsnNotThere(gid));
	return plan;
});

const GroupFontsOf = computed.group("metadata:group-fonts-of", async (target, gid) => {
	const [plan] = await target.need(BuildPlanOf(gid));
	return plan.targets;
});

const FontInfoOf = computed.group("metadata:font-info-of", async (target, fileName) => {
	const [{ fileNameToBpMap, buildPlans }] = await target.need(BuildPlans);
	const [version] = await target.need(Version);

	const fi0 = fileNameToBpMap[fileName];
	if (!fi0) fail(`Build plan for '${fileName}' not found.` + whyBuildPlanIsnNotThere(fileName));

	const bp = buildPlans[fi0.prefix];
	if (!bp) fail(`Build plan for '${fileName}' not found.` + whyBuildPlanIsnNotThere(fileName));

	const sfm = getSuffixMapping(bp.weights, bp.slopes, bp.widths);
	const sfi = sfm[fi0.suffix];
	const hintReferenceSuffix = fetchHintReferenceSuffix(sfm);

	return {
		name: fileName,
		variants: bp.variants || null,
		derivingVariants: bp.derivingVariants,
		featureControl: {
			noCvSs: bp["no-cv-ss"] || false,
			noLigation: bp["no-ligation"] || false,
			exportGlyphNames: bp["export-glyph-names"] || false
		},
		// Ligations
		ligations: bp.ligations || null,
		// Shape
		shape: {
			serifs: bp.serifs || null,
			spacing: bp.spacing || null,
			weight: sfi.shapeWeight,
			width: sfi.shapeWidth,
			slope: sfi.shapeSlope,
			slopeAngle: sfi.shapeSlopeAngle
		},
		// Menu
		menu: {
			family: bp.family,
			version: version,
			width: sfi.menuWidth,
			slope: sfi.menuSlope,
			weight: sfi.menuWeight
		},
		// CSS
		css: {
			weight: sfi.cssWeight,
			stretch: sfi.cssStretch,
			style: sfi.cssStyle
		},
		hintParams: bp.hintParams || [],
		hintReference:
			!bp["metric-override"] && hintReferenceSuffix !== fi0.suffix
				? makeFileName(fi0.prefix, hintReferenceSuffix)
				: null,
		compatibilityLigatures: bp["compatibility-ligatures"] || null,
		metricOverride: bp["metric-override"] || null,
		excludedCharRanges: bp["exclude-chars"]?.ranges
	};
});

function fetchHintReferenceSuffix(sfm) {
	if (sfm["regular"]) return "regular";

	let bestSuffix = null,
		bestSfi = null;
	for (const [suffix, sfi] of Object.entries(sfm)) {
		if (
			!bestSfi ||
			Math.abs(sfi.shapeWeight - 400) < Math.abs(bestSfi.shapeWeight - 400) ||
			(Math.abs(sfi.shapeWeight - 400) === Math.abs(bestSfi.shapeWeight - 400) &&
				Math.abs(sfi.shapeSlopeAngle) < Math.abs(bestSfi.shapeSlopeAngle)) ||
			(Math.abs(sfi.shapeWeight - 400) === Math.abs(bestSfi.shapeWeight - 400) &&
				Math.abs(sfi.shapeSlopeAngle) === Math.abs(bestSfi.shapeSlopeAngle) &&
				Math.abs(sfi.shapeWidth - 500) < Math.abs(bestSfi.shapeWidth - 500))
		) {
			bestSuffix = suffix;
			bestSfi = sfi;
		}
	}
	return bestSuffix;
}

function getSuffixMapping(weights, slopes, widths) {
	const mapping = {};
	for (const w in weights) {
		validateRecommendedWeight(w, weights[w].menu, "Menu");
		validateRecommendedWeight(w, weights[w].css, "CSS");
		for (const s in slopes) {
			for (const wd in widths) {
				const suffix = makeSuffix(w, wd, s, DEFAULT_SUBFAMILY);
				mapping[suffix] = getSuffixMappingItem(weights, w, slopes, s, widths, wd);
			}
		}
	}
	return mapping;
}
function getSuffixMappingItem(weights, w, slopes, s, widths, wd) {
	const weightDef = wwsDefValidate("Weight definition of " + s, weights[w]);
	const widthDef = wwsDefValidate("Width definition of " + s, widths[wd]);
	const slopeDef = wwsDefValidate("Slope definition of " + s, slopes[s]);
	return {
		// Weights
		weight: w,
		shapeWeight: nValidate("Shape weight of " + w, weightDef.shape, VlShapeWeight),
		cssWeight: nValidate("CSS weight of " + w, weightDef.css, VlCssWeight),
		menuWeight: nValidate("Menu weight of " + w, weightDef.menu, VlMenuWeight),

		// Widths
		width: wd,
		shapeWidth: nValidate("Shape width of " + wd, widthDef.shape, VlShapeWidth),
		cssStretch: sValidate("CSS stretch of " + wd, widthDef.css, VlCssFontStretch),
		menuWidth: nValidate("Menu width of " + wd, widthDef.menu, VlMenuWidth),

		// Slopes
		slope: s,
		shapeSlope: sValidate("Shape slope of " + s, slopeDef.shape, VlShapeSlope),
		shapeSlopeAngle: nValidate("Angle of " + s, slopeDef.angle, VlSlopeAngle),
		cssStyle: sValidate("CSS style of " + s, slopeDef.css, VlCssStyle),
		menuSlope: sValidate("Menu slope of " + s, slopeDef.menu, VlShapeSlope)
	};
}

function makeFileName(prefix, suffix) {
	return prefix + "-" + suffix;
}
function makeSuffix(w, wd, s, fallback) {
	return (
		(wd === WIDTH_NORMAL ? "" : wd) +
			(w === WEIGHT_NORMAL ? "" : w) +
			(s === SLOPE_NORMAL ? "" : s) || fallback
	);
}

function whyBuildPlanIsnNotThere(gid) {
	if (!fs.existsSync(PRIVATE_BUILD_PLANS))
		return "\n        -- Possible reason: Config file 'private-build-plans.toml' does not exist.";
	return "";
}

///////////////////////////////////////////////////////////
//////                Font Building                  //////
///////////////////////////////////////////////////////////

const DistUnhintedTTF = file.make(
	(gr, fn) => `${DIST}/${gr}/ttf-unhinted/${fn}.ttf`,
	async (target, out, gr, fn) => {
		await target.need(Scripts, Parameters, Dependencies);
		const charMapDir = `${BUILD}/ttf/${gr}`;
		const charMapPath = `${charMapDir}/${fn}.charmap.mpz`;
		const cachePath = `${charMapDir}/${fn}.cache.mpz`;

		const [fi] = await target.need(FontInfoOf(fn), de(out.dir), de(charMapDir));
		echo.action(echo.hl.command(`Create TTF`), fn, echo.hl.operator("->"), out.full);
		await silently.node("font-src/index", {
			o: out.full,
			oCharMap: charMapPath,
			oCache: cachePath,
			...fi
		});
	}
);

const BuildCM = file.make(
	(gr, f) => `${BUILD}/ttf/${gr}/${f}.charmap.mpz`,
	async (target, output, gr, f) => {
		await target.need(DistUnhintedTTF(gr, f));
	}
);

///////////////////////////////////////////////////////////
//////              Font Distribution                //////
///////////////////////////////////////////////////////////

// Group-level
const GroupContents = task.group("contents", async (target, gr) => {
	await target.need(GroupFonts(gr), DistWebFontCSS(gr));
	return gr;
});

// Webfont CSS
const DistWebFontCSS = file.make(
	gr => `${DIST}/${gr}/${gr}.css`,
	async (target, out, gr) => {
		const [plan] = await target.need(BuildPlanOf(gr));
		await target.need(de(out.dir));
		await createWebFontCssImpl(target, out.full, gr, plan.webfontFormats);
	}
);
async function createWebFontCssImpl(target, output, gr, formats) {
	const [bp, ts] = await target.need(BuildPlanOf(gr), GroupFontsOf(gr));
	const hs = await target.need(...ts.map(FontInfoOf));
	echo.action(echo.hl.command(`Create WebFont CSS`), gr, echo.hl.operator("->"), output);
	await silently.node("utility/make-webfont-css.js", output, bp.family, hs, formats);
}

// Content files
const GroupTTFs = task.group("ttf", async (target, gr) => {
	const [ts] = await target.need(GroupFontsOf(gr));
	await target.need(ts.map(tn => DistHintedTTF(gr, tn)));
});
const GroupUnhintedTTFs = task.group("ttf-unhinted", async (target, gr) => {
	const [ts] = await target.need(GroupFontsOf(gr));
	await target.need(ts.map(tn => DistUnhintedTTF(gr, tn)));
});
const GroupWebFonts = task.group("webfont", async (target, gr) => {
	const [bp] = await target.need(BuildPlanOf(gr));
	const groupsNeeded = [];
	for (const ext of bp.webfontFormats) {
		switch (ext) {
			case "ttf":
				groupsNeeded.push(GroupTTFs(gr));
				break;
			case "woff2":
				groupsNeeded.push(GroupWoff2s(gr));
				break;
		}
	}
	await target.need(groupsNeeded, DistWebFontCSS(gr));
});
const GroupWoff2s = task.group("woff2", async (target, gr) => {
	const [ts] = await target.need(GroupFontsOf(gr));
	await target.need(ts.map(tn => DistWoff2(gr, tn)));
});
const GroupFonts = task.group("fonts", async (target, gr) => {
	await target.need(GroupTTFs(gr), GroupUnhintedTTFs(gr), GroupWoff2s(gr));
});

// Per group file
const DistHintedTTF = file.make(
	(gr, fn) => `${DIST}/${gr}/ttf/${fn}.ttf`,
	async (target, out, gr, fn) => {
		const [{ hintParams }, hint] = await target.need(FontInfoOf(fn), CheckTtfAutoHintExists);
		const [from] = await target.need(DistUnhintedTTF(gr, fn), de`${out.dir}`);
		echo.action(echo.hl.command(`Hint TTF`), from.full, echo.hl.operator("->"), out.full);
		await silently.run(hint, hintParams, from.full, out.full);
	}
);
const DistWoff2 = file.make(
	(gr, fn) => `${DIST}/${gr}/woff2/${fn}.woff2`,
	async (target, out, group, f) => {
		const [from] = await target.need(DistHintedTTF(group, f), de`${out.dir}`);
		echo.action(echo.hl.command("Create WOFF2"), from.full, echo.hl.operator("->"), out.full);
		await silently.node(`utility/ttf-to-woff2.js`, from.full, out.full);
	}
);

///////////////////////////////////////////////////////////
//////            Font Collection Plans              //////
///////////////////////////////////////////////////////////

const CollectPlans = computed(`metadata:collect-plans`, async target => {
	const [rawPlans] = await target.need(RawPlans);
	return await getCollectPlans(target, rawPlans.collectPlans);
});

async function getCollectPlans(target, rawCollectPlans) {
	const plans = {};

	let allCollectableGroups = new Set();
	for (const collectPrefix in rawCollectPlans) {
		const collect = rawCollectPlans[collectPrefix];
		if (!collect.release) continue;
		for (const gr of collect.from) allCollectableGroups.add(gr);
	}

	const amendedRawCollectPlans = { ...rawCollectPlans };
	for (const gr of allCollectableGroups) {
		amendedRawCollectPlans[`sgr-` + gr] = { release: true, isAmended: true, from: [gr] };
	}

	for (const collectPrefix in amendedRawCollectPlans) {
		const glyfTtcComposition = {};
		const ttcComposition = {};
		const collect = amendedRawCollectPlans[collectPrefix];
		if (!collect || !collect.from || !collect.from.length) continue;

		for (const prefix of collect.from) {
			const [gri] = await target.need(BuildPlanOf(prefix));
			const ttfFileNameSet = new Set(gri.targets);
			const suffixMap = getSuffixMapping(gri.weights, gri.slopes, gri.widths);
			for (const suffix in suffixMap) {
				const sfi = suffixMap[suffix];

				const ttfTargetName = makeFileName(prefix, suffix);
				if (!ttfFileNameSet.has(ttfTargetName)) continue;

				const glyfTtcFileName = fnStandardTtc(true, collectPrefix, suffixMap, sfi);
				if (!glyfTtcComposition[glyfTtcFileName]) glyfTtcComposition[glyfTtcFileName] = [];
				glyfTtcComposition[glyfTtcFileName].push({ dir: prefix, file: ttfTargetName });

				const ttcFileName = fnStandardTtc(false, collectPrefix, suffixMap, sfi);
				if (!ttcComposition[ttcFileName]) ttcComposition[ttcFileName] = [];
				ttcComposition[ttcFileName].push(glyfTtcFileName);
			}
		}
		plans[collectPrefix] = {
			glyfTtcComposition,
			ttcComposition,
			groupDecomposition: [...collect.from],
			inRelease: !!collect.release,
			isAmended: !!collect.isAmended
		};
	}
	return plans;
}

function fnStandardTtc(fIsGlyfTtc, prefix, suffixMapping, sfi) {
	let optimalSfi = null,
		maxScore = 0;
	for (const ttcSuffix in suffixMapping) {
		const sfiT = suffixMapping[ttcSuffix];
		if (sfi.shapeWeight !== sfiT.shapeWeight) continue;
		if (fIsGlyfTtc && sfi.shapeWidth !== sfiT.shapeWidth) continue;
		if (fIsGlyfTtc && sfi.shapeSlopeAngle !== sfiT.shapeSlopeAngle) continue;
		const score =
			(sfiT.weight === WEIGHT_NORMAL ? 1 : 0) +
			(sfiT.width === WIDTH_NORMAL ? 1 : 0) +
			(sfiT.slope === SLOPE_NORMAL ? 1 : 0);
		if (!optimalSfi || score > maxScore) {
			maxScore = score;
			optimalSfi = sfiT;
		}
	}
	if (!optimalSfi) throw new Error("Unreachable: TTC name decision");
	return `${prefix}-${makeSuffix(
		optimalSfi.weight,
		optimalSfi.width,
		optimalSfi.slope,
		DEFAULT_SUBFAMILY
	)}`;
}

///////////////////////////////////////////////////////////
//////               Font Collection                 //////
///////////////////////////////////////////////////////////

const SpecificTtc = task.group(`ttc`, async (target, cgr) => {
	const outputDir = `dist/.ttc/${cgr}`;
	const [cPlan] = await target.need(CollectPlans, de(outputDir));
	const ttcFiles = Array.from(Object.keys(cPlan[cgr].ttcComposition));
	const [files] = await target.need(ttcFiles.map(pt => CollectedTtcFile(cgr, pt)));
	for (const file of files) await cp(file.full, `${outputDir}/${file.base}`);
});
const SpecificSuperTtc = task.group(`super-ttc`, async (target, cgr) => {
	await target.need(CollectedSuperTtcFile(cgr));
});
const CollectedSuperTtcFile = file.make(
	cgr => `${DIST_SUPER_TTC}/${cgr}.ttc`,
	async (target, out, cgr) => {
		const [cp] = await target.need(CollectPlans, de(out.dir));
		const parts = Array.from(Object.keys(cp[cgr].glyfTtcComposition));
		const [inputs] = await target.need(parts.map(pt => GlyfTtc(cgr, pt)));
		await buildCompositeTtc(out, inputs);
	}
);
const CollectedTtcFile = file.make(
	(cgr, f) => `${BUILD}/ttc-collect/${cgr}/${f}.ttc`,
	async (target, out, cgr, f) => {
		const [cp] = await target.need(CollectPlans, de`${out.dir}`);
		const parts = Array.from(new Set(cp[cgr].ttcComposition[f]));
		const [inputs] = await target.need(parts.map(pt => GlyfTtc(cgr, pt)));
		await buildCompositeTtc(out, inputs);
	}
);
const GlyfTtc = file.make(
	(cgr, f) => `${BUILD}/glyf-ttc/${cgr}/${f}.ttc`,
	async (target, out, cgr, f) => {
		const [cp] = await target.need(CollectPlans);
		const parts = cp[cgr].glyfTtcComposition[f];
		await buildGlyphSharingTtc(target, parts, out);
	}
);
async function buildCompositeTtc(out, inputs) {
	const inputPaths = inputs.map(f => f.full);
	await run(TTCIZE, ["-o", out.full], inputPaths);
}
async function buildGlyphSharingTtc(target, parts, out) {
	await target.need(de`${out.dir}`);
	const [ttfInputs] = await target.need(parts.map(part => DistUnhintedTTF(part.dir, part.file)));
	const tmpTtc = `${out.dir}/${out.name}.unhinted.ttc`;
	const ttfInputPaths = ttfInputs.map(p => p.full);
	await run(TTCIZE, "-u", ["-o", tmpTtc], ttfInputPaths);
	await run("ttfautohint", tmpTtc, out.full);
	await rm(tmpTtc);
}

///////////////////////////////////////////////////////////
//////                   Archives                    //////
///////////////////////////////////////////////////////////

// Collection Archives
const TtcArchiveFile = file.make(
	(cgr, version) => `${ARCHIVE_DIR}/ttc-${cgr}-${version}.zip`,
	async (target, out, cgr) => {
		const [cPlan] = await target.need(CollectPlans, de`${out.dir}`);
		const ttcFiles = Array.from(Object.keys(cPlan[cgr].ttcComposition));
		await target.need(ttcFiles.map(pt => CollectedTtcFile(cgr, pt)));
		await CreateGroupArchiveFile(`${BUILD}/ttc-collect/${cgr}`, out, `*.ttc`);
	}
);
const SuperTtcArchiveFile = file.make(
	(cgr, version) => `${ARCHIVE_DIR}/super-ttc-${cgr}-${version}.zip`,
	async (target, out, cgr) => {
		await target.need(de`${out.dir}`, CollectedSuperTtcFile(cgr));
		await CreateGroupArchiveFile(DIST_SUPER_TTC, out, `${cgr}.ttc`);
	}
);

// Single-group Archives
const GroupTtfArchiveFile = file.make(
	(gr, version) => `${ARCHIVE_DIR}/ttf-${gr}-${version}.zip`,
	async (target, out, gr) => {
		await target.need(de`${out.dir}`);
		await target.need(GroupContents(gr));
		await CreateGroupArchiveFile(`${DIST}/${gr}/ttf`, out, "*.ttf");
	}
);
const GroupTtfUnhintedArchiveFile = file.make(
	(gr, version) => `${ARCHIVE_DIR}/ttf-unhinted-${gr}-${version}.zip`,
	async (target, out, gr) => {
		await target.need(de`${out.dir}`);
		await target.need(GroupContents(gr));
		await CreateGroupArchiveFile(`${DIST}/${gr}/ttf-unhinted`, out, "*.ttf");
	}
);
const GroupWebArchiveFile = file.make(
	(gr, version) => `${ARCHIVE_DIR}/webfont-${gr}-${version}.zip`,
	async (target, out, gr) => {
		const [plan] = await target.need(BuildPlanOf(gr));
		await target.need(de`${out.dir}`);
		await target.need(GroupContents(gr));
		await CreateGroupArchiveFile(`${DIST}/${gr}`, out, "*.css", ...plan.webfontFormats);
	}
);

async function CreateGroupArchiveFile(dir, out, ...files) {
	const relOut = Path.relative(dir, out.full);
	await rm(out.full);
	echo.action(echo.hl.command("Create Archive"), out.full);
	await cd(dir).silently.run(["7z", "a"], ["-tzip", "-r", "-mx=9", "-mmt=off"], relOut, ...files);
}

///////////////////////////////////////////////////////////
//////                    Exports                    //////
///////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////
// Sample Images

const Pages = task(`pages`, async t => {
	await t.need(
		PagesDataExport,
		PagesFontExport`iosevka`,
		PagesFontExport`iosevka-slab`,
		PagesFontExport`iosevka-aile`,
		PagesFontExport`iosevka-etoile`,
		PagesFontExport`iosevka-QP`,
		PagesFontExport`iosevka-QP-slab`,
		PagesFontExport`iosevka-QPE`,
		PagesFontExport`iosevka-QPE-slab`
	);
});

const PagesDir = oracle(`pages-dir-path`, async t => {
	const [rp] = await t.need(RawPlans);
	if (!rp.buildOptions || !rp.buildOptions.__pagesDir) fail("Pages directory not found");
	return rp.buildOptions.__pagesDir;
});

const PagesDataExport = task(`pages:data-export`, async t => {
	const [pagesDir] = await t.need(PagesDir, Version, Parameters, UtilScripts);
	const [cm, cmi, cmo] = await t.need(
		BuildCM("iosevka", "iosevka-regular"),
		BuildCM("iosevka", "iosevka-italic"),
		BuildCM("iosevka", "iosevka-oblique")
	);
	await node(`utility/export-data/index`, {
		charMapPath: cm.full,
		charMapItalicPath: cmi.full,
		charMapObliquePath: cmo.full,
		exportPathMeta: Path.resolve(pagesDir, "shared/data-import/raw/metadata.json"),
		exportPathCov: Path.resolve(pagesDir, "shared/data-import/raw/coverage.json")
	});
});

const PagesFontExport = task.group(`pages:font-export`, async (target, gr) => {
	target.is.volatile();
	const [pagesDir] = await target.need(PagesDir);
	if (!pagesDir) return;
	const outDir = Path.resolve(pagesDir, "shared/fonts", gr);
	await target.need(GroupWebFonts(gr), de(outDir));
	await cp(`${DIST}/${gr}/woff2`, Path.resolve(outDir, "woff2"));
	await createWebFontCssImpl(target, Path.resolve(outDir, `${gr}.css`), gr, webfontFormatsPages);
	await rm(Path.resolve(outDir, "ttf"));
});

const PagesFastFontExport = task.group(`pages:fast-font-export`, async (target, gr) => {
	target.is.volatile();
	const [pagesDir] = await target.need(PagesDir);
	if (!pagesDir) return;
	const outDir = Path.resolve(pagesDir, "shared/fonts", gr);
	await target.need(GroupTTFs(gr), de(outDir));
	await cp(`${DIST}/${gr}/ttf`, Path.resolve(outDir, "ttf"));
	await createWebFontCssImpl(target, Path.resolve(outDir, `${gr}.css`), gr, webfontFormatsFast);
	await rm(Path.resolve(outDir, "woff2"));
});

///////////////////////////////////////////////////////////
// Sample Images

const SnapshotParallel = 8;
const SampleImages = task(`sample-images`, async target => {
	const [cfgP, sh] = await target.need(PackageSnapshotConfig, SnapShotHtml, TakeSampleImages);
	let snapshotFiles = [...cfgP];
	for (let i = 0; i < SnapshotParallel; i++) {
		const de = JSON.parse(fs.readFileSync(`${sh.dir}/readme-tasks-${i}.json`));
		for (const x of de) snapshotFiles.push(x);
	}
	await target.need(
		snapshotFiles.map(opt => ScreenShot(opt.name + ".dark")),
		snapshotFiles.map(opt => ScreenShot(opt.name + ".light"))
	);
});

const SampleImagesPre = task(`sample-images:pre`, async target => {
	const [sans, slab, aile, etoile] = await target.need(
		GroupContents`iosevka`,
		GroupContents`iosevka-slab`,
		GroupContents`iosevka-aile`,
		GroupContents`iosevka-etoile`,
		SnapShotStatic("index.js"),
		SnapShotStatic("get-snap.js"),
		SnapShotJson,
		SnapShotCSS,
		SnapShotHtml,
		de`images`,
		de(SNAPSHOT_TMP)
	);
	await cp(`${DIST}/${sans}`, `${SNAPSHOT_TMP}/${sans}`);
	await cp(`${DIST}/${slab}`, `${SNAPSHOT_TMP}/${slab}`);
	await cp(`${DIST}/${aile}`, `${SNAPSHOT_TMP}/${aile}`);
	await cp(`${DIST}/${etoile}`, `${SNAPSHOT_TMP}/${etoile}`);
});

const PackageSnapshotConfig = computed(`package-snapshot-config`, async target => {
	const [plan] = await target.need(BuildPlans);
	const cfg = [];
	for (const key in plan.buildPlans) {
		const p = plan.buildPlans[key];
		if (!p || !p.snapshotFamily) continue;
		cfg.push({
			el: "#packaging-sampler",
			applyClass: p.snapshotFamily,
			applyFeature: p.snapshotFeature,
			name: key,
			applyCallback: `cbAmendStylisticSetContents`,
			applyCallbackArgs: { hotChars: [] }
		});
	}
	return cfg;
});
const SnapShotJson = file(`${SNAPSHOT_TMP}/packaging-tasks.json`, async (target, out) => {
	const [cfg] = await target.need(PackageSnapshotConfig, de(out.dir));
	fs.writeFileSync(out.full, JSON.stringify(cfg, null, "  "));
});
const SnapShotHtml = file(`${SNAPSHOT_TMP}/index.html`, async (target, out) => {
	await target.need(Parameters, UtilScripts, SnapshotTemplates, de(out.dir));
	await node(`utility/generate-snapshot-page/index`, {
		inputPath: "snapshot-src/templates",
		outputPath: out.full,
		outputDataPath: `${out.dir}/${out.name}.data.json`,
		outputTaskFilePrefix: `${out.dir}/readme-tasks`,
		parallel: SnapshotParallel
	});
});

const AmendReadme = task("amend-readme", async target => {
	await target.need(Parameters, UtilScripts);
	const [cm, cmi, cmo] = await target.need(
		BuildCM("iosevka", "iosevka-regular"),
		BuildCM("iosevka", "iosevka-italic"),
		BuildCM("iosevka", "iosevka-oblique")
	);
	await amendReadmeFor("README.md", cm, cmi, cmo);
	await amendReadmeFor("doc/stylistic-sets.md", cm, cmi, cmo);
	await amendReadmeFor("doc/character-variants.md", cm, cmi, cmo);
	await amendReadmeFor("doc/custom-build.md", cm, cmi, cmo);
	await amendReadmeFor("doc/language-specific-ligation-sets.md", cm, cmi, cmo);
});
async function amendReadmeFor(md, cm, cmi, cmo) {
	return node(`utility/amend-readme/index`, {
		mdFilePath: md,
		charMapPath: cm.full,
		charMapItalicPath: cmi.full,
		charMapObliquePath: cmo.full
	});
}

const SnapShotStatic = file.make(
	x => `${SNAPSHOT_TMP}/${x}`,
	async (target, out) => {
		const [$1] = await target.need(sfu`snapshot-src/${out.base}`, de(out.dir));
		await cp($1.full, `${out.dir}/${$1.base}`);
	}
);
const SnapShotCSS = file(`${SNAPSHOT_TMP}/index.css`, async (target, out) => {
	const [$1] = await target.need(sfu`snapshot-src/index.styl`, de(out.dir));
	await cp($1.full, `${out.dir}/${$1.base}`);
	await run(`npx`, `stylus`, `${out.dir}/${$1.base}`, `-c`);
});
const TakeSampleImages = task(`sample-images:take`, async target => {
	await target.need(SampleImagesPre);

	await run("npm", "install", "--no-save", "electron");

	let taskLists = [`packaging-tasks.json`];
	for (let i = 0; i < SnapshotParallel; i++) taskLists.push(`readme-tasks-${i}.json`);
	await Promise.all(
		taskLists.map((file, i) =>
			Delay(i * 4000).then(() =>
				cd(SNAPSHOT_TMP).run("npx", "electron", "get-snap.js", "../../images", file)
			)
		)
	);
});
const ScreenShot = file.make(
	img => `images/${img}.png`,
	async (target, out) => {
		await target.need(TakeSampleImages);
		await run(
			"magick",
			...[`${out.dir}/${out.name}.black.png`, `${out.dir}/${out.name}.white.png`],
			..."( -clone 0-1 -fx u-v+1 )".split(" "),
			..."( -clone 0,2 -compose DivideSrc -composite )".split(" "),
			..."( -clone 3,2 -alpha Off -compose CopyOpacity -composite )".split(" "),
			...["-delete", "0-3", out.full]
		);
		await rm(`${out.dir}/${out.name}.black.png`);
		await rm(`${out.dir}/${out.name}.white.png`);
		await run("optipng", ["--strip", "all"], out.full);
	}
);

///////////////////////////////////////////////////////////
// Release notes

const ReleaseNotes = task(`release:release-note`, async t => {
	const [version] = await t.need(Version);
	await t.need(ReleaseNotesFile(version), ReleaseNotesPackageListMD(version));
});
const ReleaseNotesFile = file.make(
	version => `${ARCHIVE_DIR}/release-notes-${version}.md`,
	async (t, out, version) => {
		await t.need(Version, UtilScripts, de(ARCHIVE_DIR));
		const [changeFiles, rpFiles] = await t.need(ChangeFileList(), ReleaseNotePackagesFile);
		await t.need(changeFiles.map(fu));
		await node("utility/generate-release-note/index", {
			version,
			releasePackagesJsonPath: rpFiles.full,
			outputPath: out.full
		});
	}
);
const ReleaseNotesPackageListMD = file.make(
	version => `doc/PACKAGE-LIST.md`,
	async (t, out, version) => {
		await t.need(Version, UtilScripts, de(ARCHIVE_DIR));
		const [changeFiles, rpFiles] = await t.need(ChangeFileList(), ReleaseNotePackagesFile);
		await t.need(changeFiles.map(fu));
		await node("utility/generate-release-note/package-list", {
			version,
			releasePackagesJsonPath: rpFiles.full,
			outputPath: out.full
		});
	}
);
const ReleaseNotePackagesFile = file(`${BUILD}/release-packages.json`, async (t, out) => {
	const [cp] = await t.need(CollectPlans);
	const [{ buildPlans }] = await t.need(BuildPlans);
	let releaseNoteGroups = {};
	for (const [k, plan] of Object.entries(cp)) {
		if (!plan.inRelease || plan.isAmended) continue;
		const primePlan = buildPlans[plan.groupDecomposition[0]];
		let subGroups = {};
		for (const gr of plan.groupDecomposition) {
			const bp = buildPlans[gr];
			subGroups[gr] = {
				family: bp.family,
				desc: bp.desc,
				spacing: buildPlans[gr].spacing || "type"
			};
		}
		releaseNoteGroups[k] = {
			subGroups,
			slab: primePlan.serifs === "slab",
			quasiProportional: primePlan.spacing === "quasi-proportional"
		};
	}
	await fs.promises.writeFile(out.full, JSON.stringify(releaseNoteGroups, null, "  "));
});
const ChangeLog = task(`release:change-log`, async t => {
	await t.need(ChangeLogFile);
});
const ChangeLogFile = file(`CHANGELOG.md`, async (t, out) => {
	const [version] = await t.need(Version);
	await t.need(UtilScripts, de(ARCHIVE_DIR));
	const [changeFiles] = await t.need(ChangeFileList());
	await t.need(changeFiles.map(fu));
	await node("utility/generate-change-log/index", { version, outputPath: out.full });
});
const ChangeFileList = oracle.make(
	() => `release:change-file-list`,
	target => FileList({ under: "changes", pattern: "*.md" })(target)
);

///////////////////////////////////////////////////////////
//////                   Entries                     //////
///////////////////////////////////////////////////////////

phony(`clean`, async () => {
	await rm(BUILD);
	await rm(DIST);
	await rm(ARCHIVE_DIR);
	build.deleteJournal();
});
phony(`release`, async target => {
	const [collectPlans] = await target.need(CollectPlans);
	let goals = [];
	for (const [cgr, plan] of Object.entries(collectPlans)) {
		if (!plan.inRelease) continue;
		goals.push(ReleaseGroup(cgr));
	}
	await target.need(goals);
	await target.need(SampleImages, Pages, AmendReadme, ReleaseNotes, ChangeLog);
});
const ReleaseGroup = phony.group("release-group", async (target, cgr) => {
	const [version, collectPlans] = await target.need(Version, CollectPlans);
	const subGroups = collectPlans[cgr].groupDecomposition;

	let goals = [TtcArchiveFile(cgr, version), SuperTtcArchiveFile(cgr, version)];
	for (const gr of subGroups) {
		goals.push(GroupTtfArchiveFile(gr, version));
		goals.push(GroupTtfUnhintedArchiveFile(gr, version));
		goals.push(GroupWebArchiveFile(gr, version));
	}

	await target.need(goals);
});

///////////////////////////////////////////////////////////
//////               Script Building                 //////
///////////////////////////////////////////////////////////

const MARCOS = [fu`font-src/meta/macros.ptl`];
const ScriptsUnder = oracle.make(
	(ext, dir) => `${ext}-scripts-under::${dir}`,
	(target, ext, dir) => FileList({ under: dir, pattern: `**/*.${ext}` })(target)
);
const UtilScriptFiles = computed("util-script-files", async target => {
	const [js, ejs, md] = await target.need(
		ScriptsUnder("js", "utility"),
		ScriptsUnder("ejs", "utility"),
		ScriptsUnder("md", "utility")
	);
	return [...js, ...ejs, ...md];
});
const SnapshotTemplateFiles = computed("snapshot-templates", async target => {
	const [js, ejs, md] = await target.need(
		ScriptsUnder("js", "snapshot-src"),
		ScriptsUnder("ejs", "snapshot-src"),
		ScriptsUnder("md", "snapshot-src")
	);
	return [...js, ...ejs, ...md];
});
const ScriptFiles = computed.group("script-files", async (target, ext) => {
	const [ss] = await target.need(ScriptsUnder(ext, `font-src`));
	return ss;
});
const JavaScriptFromPtl = computed("scripts-js-from-ptl", async target => {
	const [ptl] = await target.need(ScriptFiles("ptl"));
	return ptl.map(x => replaceExt(".js", x));
});
function replaceExt(extNew, file) {
	return Path.posix.join(Path.dirname(file), Path.basename(file, Path.extname(file)) + extNew);
}

const CompiledJs = file.make(
	p => p,
	async (target, out) => {
		const ptl = replaceExt(".ptl", out.full);
		if (/\/glyphs\//.test(out.full)) await target.need(MARCOS);
		await target.need(sfu(ptl));
		echo.action(echo.hl.command("Compile Script"), ptl);
		await silently.run(PATEL_C, "--strict", ptl, "-o", out.full);
	}
);
const Scripts = task("scripts", async target => {
	const [jsFromPtlList] = await target.need(JavaScriptFromPtl);
	const [jsList] = await target.need(ScriptFiles("js"));
	const jsFromPtlSet = new Set(jsFromPtlList);

	let subGoals = [];
	for (const js of jsFromPtlSet) subGoals.push(CompiledJs(js));
	for (const js of jsList) if (!jsFromPtlSet.has(js)) subGoals.push(sfu(js));
	await target.need(subGoals);
});
const UtilScripts = task("util-scripts", async target => {
	const [files] = await target.need(UtilScriptFiles);
	await target.need(files.map(fu));
});
const SnapshotTemplates = task("snapshot-templates", async target => {
	const [files] = await target.need(SnapshotTemplateFiles);
	await target.need(files.map(fu));
});
const Parameters = task(`meta:parameters`, async target => {
	await target.need(
		Version,
		sfu`params/parameters.toml`,
		sfu`params/shape-weight.toml`,
		sfu`params/shape-width.toml`,
		sfu`params/shape-slope.toml`,
		ofu`params/private-parameters.toml`,
		sfu`params/variants.toml`,
		sfu`params/ligation-set.toml`
	);
});

///////////////////////////////////////////////////////////
//////              Config Validation                //////
///////////////////////////////////////////////////////////

// Build plan validation
function validateAndShimBuildPlans(prefix, bp, dWeights, dSlopes, dWidths) {
	if (!bp.family) {
		fail(`Build plan for ${prefix} does not have a family name. Exit.`);
	}
	if (!bp.slopes && bp.slants) {
		echo.warn(
			`Build plan for ${prefix} uses legacy "slants" to define slopes. ` +
				`Use "slopes" instead.`
		);
	}

	bp.weights = shimBpAspect("weights", bp.weights, dWeights);
	bp.slopes = shimBpAspect("slopes", bp.slopes || bp.slants, dSlopes);
	bp.widths = shimBpAspect("widths", bp.widths, dWidths);
}
function shimBpAspect(aspectName, aspect, defaultAspect) {
	if (!aspect) return defaultAspect;
	const result = {};
	for (const [k, v] of Object.entries(aspect)) {
		shimBpAspectKey(aspectName, result, k, v, defaultAspect);
	}
	return result;
}
function shimBpAspectKey(aspectName, sink, k, v, defaultAspect) {
	if (typeof v === "string") {
		if (!/^default\./.test(v))
			throw new Error(`Invalid configuration '${v}' for ${aspectName}.${k}'`);
		const remappingKey = v.slice("default.".length);
		if (!defaultAspect[remappingKey])
			throw new Error(`Invalid configuration '${v}' for ${aspectName}.${k}'`);
		sink[k] = defaultAspect[remappingKey];
	} else {
		sink[k] = v;
	}
}

// Recommended weight validation
function validateRecommendedWeight(w, value, label) {
	const RecommendedMenuWeights = {
		thin: 100,
		extralight: 200,
		light: 300,
		regular: 400,
		book: 450,
		medium: 500,
		semibold: 600,
		bold: 700,
		extrabold: 800,
		heavy: 900
	};
	if (RecommendedMenuWeights[w] && RecommendedMenuWeights[w] !== value) {
		echo.warn(
			`${label} weight settings of ${w} ( = ${value}) doesn't match ` +
				`the recommended value ( = ${RecommendedMenuWeights[w]}).`
		);
	}
}

// Value validation
function wwsDefValidate(key, obj) {
	if (!obj || typeof obj === "string") {
		throw new TypeError(`${key} is invalid.`);
	}
	return obj;
}

function nValidate(key, v, validator) {
	if (validator.fixup) v = validator.fix(v);
	if (typeof v !== "number" || !isFinite(v) || !validator.validate(v)) {
		throw new TypeError(`${key} = ${v} is not a valid number.`);
	}
	return v;
}

const VlShapeWeight = { validate: x => x >= 100 && x <= 1000 };
const VlCssWeight = { validate: x => x > 0 && x <= 1000 };
const VlMenuWeight = VlCssWeight;

const g_widthFixupMemory = new Map();
const VlShapeWidth = {
	validate: x => x >= 416 && x <= 720,
	fix(x) {
		if (x >= 3 && x <= 9) {
			if (g_widthFixupMemory.has(x)) return g_widthFixupMemory.get(x);
			const xCorrected = Math.round(500 * Math.pow(Math.sqrt(600 / 500), x - 5));
			echo.warn(
				`The build plan is using legacy width grade ${x}. ` +
					`Converting to unit width ${xCorrected}.`
			);
			g_widthFixupMemory.set(x, xCorrected);
			return xCorrected;
		} else {
			return x;
		}
	}
};
const VlMenuWidth = { validate: x => x >= 1 && x <= 9 && x % 1 === 0 };
const VlSlopeAngle = { validate: x => x >= 0 && x <= 15 };

function sValidate(key, v, validator) {
	if (validator.fixup) v = validator.fix(v);
	if (typeof v !== "string" || !validator.validate(v)) {
		throw new TypeError(`${key} = ${v} is not a valid string.`);
	}
	return v;
}
const VlShapeSlope = { validate: x => x === "upright" || x === "oblique" || x === "italic" };
const VlCssStyle = { validate: x => x === "normal" || x === "oblique" || x === "italic" };
const VlCssFontStretch = {
	validate: x =>
		x == "ultra-condensed" ||
		x == "extra-condensed" ||
		x == "condensed" ||
		x == "semi-condensed" ||
		x == "normal" ||
		x == "semi-expanded" ||
		x == "expanded" ||
		x == "extra-expanded" ||
		x == "ultra-expanded"
};

// Utilities

function Delay(t) {
	return new Promise(resolve => setTimeout(resolve, t));
}
