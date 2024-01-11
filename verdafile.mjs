import * as FS from "fs"
import * as Path from "path"
import * as toml from "@iarna/toml"
import deepEqual from "deep-equal"
import semver from "semver"
import * as uuid from "uuid"
import * as Verda from "verda"
import which from "which"

///////////////////////////////////////////////////////////
export const build = Verda.create()
const { task, file, oracle, computed } = build.ruleTypes
const { de, fu, sfu, ofu } = build.rules
const { rm, fail, echo, silently, absolutelySilently } = build.actions
const { FileList } = build.predefinedFuncs

///////////////////////////////////////////////////////////
const BUILD = ".build"
const DIST = "dist"
const GLYF_TTC = `${BUILD}/ttc-glyf`
const SHARED_CACHE = `${BUILD}/cache`
const PATEL_C = ["node", "node_modules/patel/bin/patel-c"]
const MAKE_TTC = ["node", "node_modules/otb-ttc-bundle/bin/otb-ttc-bundle"]
const TTFAUTOHINT = process.env.TTFAUTOHINT_PATH || "ttfautohint"
const defaultWebFontFormats = ["WOFF2", "TTF"]
const WIDTH_NORMAL = "normal"
const WEIGHT_NORMAL = "regular"
const SLOPE_NORMAL = "upright"
const DEFAULT_SUBFAMILY = "regular"
const BUILD_PLANS = "build-plans.toml"
const PRIVATE_BUILD_PLANS = "private-build-plans.toml"

// Save journal to build/
build.setJournal(`${BUILD}/.verda-build-journal`)
// Enable self-tracking
build.setSelfTracking()

///////////////////////////////////////////////////////////
//////                   Oracles                     //////
///////////////////////////////////////////////////////////
const Version = computed(`env::version`, async (target) => {
	const [pjf] = await target.need(sfu`package.json`)
	const pj = JSON.parse(await FS.promises.readFile(pjf.full, "utf-8"))
	return pj.version
})

const CheckTtfAutoHintExists = oracle(`oracle:check-ttfautohint-exists`, async (target) => {
	try {
		return await which(TTFAUTOHINT)
	} catch (e) {
		fail("External dependency <ttfautohint>, needed for building hinted font, does not exist.")
	}
})

const Dependencies = computed("env::dependencies", async (target) => {
	const [pjf] = await target.need(sfu`package.json`)
	const pj = JSON.parse(await FS.promises.readFile(pjf.full, "utf-8"))
	let subGoals = []
	for (const pkgName in pj.dependencies) subGoals.push(InstalledVersion(pkgName, pj.dependencies[pkgName]))
	const [actual] = await target.need(subGoals)
	return actual
})

const InstalledVersion = computed.make(
	(pkg, required) => `env::installed-version::${pkg}::${required}`,
	async (target, pkg, required) => {
		const [pj] = await target.need(sfu(`node_modules/${pkg}/package.json`))
		const depPkg = JSON.parse(await FS.promises.readFile(pj.full))
		if (!semver.satisfies(depPkg.version, required)) fail(`Package version for ${pkg} is outdated:`, `Required ${required}, Installed ${depPkg.version}`)
		return { name: pkg, actual: depPkg.version, required }
	}
)

///////////////////////////////////////////////////////////
//////                    Plans                      //////
///////////////////////////////////////////////////////////
const RawPlans = computed(`metadata:raw-plans`, async (target) => {
	await target.need(sfu(BUILD_PLANS), ofu(PRIVATE_BUILD_PLANS), Version)
	const bp = await tryParseToml(BUILD_PLANS)
	bp.buildOptions = bp.buildOptions || {}
	if (FS.existsSync(PRIVATE_BUILD_PLANS)) {
		const privateBP = await tryParseToml(PRIVATE_BUILD_PLANS)
		Object.assign(bp.buildPlans, privateBP.buildPlans || {})
		Object.assign(bp.collectPlans, privateBP.collectPlans || {})
		Object.assign(bp.buildOptions, privateBP.buildOptions || {})
	}
	return bp
})
async function tryParseToml(str) {
	try {
		return JSON.parse(JSON.stringify(toml.parse(FS.readFileSync(str, "utf-8"))))
	} catch (e) {
		throw new Error(`Failed to parse configuration file ${str}.\nPlease validate whether there's syntax error.\n${e}`)
	}
}

const BuildPlans = computed("metadata:build-plans", async (target) => {
	const [rp] = await target.need(RawPlans)
	const rawBuildPlans = rp.buildPlans
	// Initialize build plans
	const returnBuildPlans = {}
	for (const prefix in rawBuildPlans) {
		const bp = { ...rawBuildPlans[prefix] }
		validateBuildPlan(prefix, bp)
		bp.webfontFormats = bp.webfontFormats || defaultWebFontFormats
		bp.targets = []
		returnBuildPlans[prefix] = bp
	}
	// Resolve WWS, including inheritance and default config
	for (const prefix in rawBuildPlans) resolveWws(prefix, returnBuildPlans, rp)
	// Create file name to BP mapping
	const fileNameToBpMap = {}
	for (const prefix in rawBuildPlans) {
		const bp = returnBuildPlans[prefix]
		const weights = bp.weights,
			slopes = bp.slopes,
			widths = bp.widths
		const suffixMapping = getSuffixMapping(weights, slopes, widths)
		for (const suffix in suffixMapping) {
			const sfi = suffixMapping[suffix]
			if (weights && !weights[sfi.weight]) continue
			if (slopes && !slopes[sfi.slope]) continue
			const fileName = makeFileName(prefix, suffix)
			bp.targets.push(fileName)
			fileNameToBpMap[fileName] = { prefix, suffix }
		}
		returnBuildPlans[prefix] = bp
	}
	linkSpacingDerivableBuildPlans(returnBuildPlans)
	return { fileNameToBpMap, buildPlans: returnBuildPlans }
})

function linkSpacingDerivableBuildPlans(bps) {
	for (const pfxTo in bps) {
		const bpTo = bps[pfxTo]
		if (blockSpacingDerivationTo(bpTo)) continue
		if (!isDeriveToSpacing(bpTo.spacing)) continue
		for (const pfxFrom in bps) {
			const bpFrom = bps[pfxFrom]
			if (!isDeriveFromSpacing(bpFrom.spacing)) continue
			if (!spacingDeriveCompatible(pfxTo, bpTo, pfxFrom, bpFrom)) continue
			bpTo.spacingDeriveFrom = pfxFrom
		}
	}
}
function blockSpacingDerivationTo(bp) {
	return !!bp.compatibilityLigatures
}
function isDeriveToSpacing(spacing) {
	return spacing === "term" || spacing === "fontconfig-mono" || spacing === "fixed"
}
function isDeriveFromSpacing(spacing) {
	return !spacing || spacing === "normal"
}
function spacingDeriveCompatible(pfxTo, bpTo, pfxFrom, bpFrom) {
	// If the two build plans are the same, then they are compatible.
	return deepEqual(rectifyPlanForSpacingDerive(bpTo), rectifyPlanForSpacingDerive(bpFrom))
}
function rectifyPlanForSpacingDerive(p) {
	return {
		...p,
		family: "#Validation",
		desc: "#Validation",
		spacing: "#Validation",
		buildCharMap: false,
		snapshotFamily: null,
		snapshotFeature: null,
		targets: null,
	}
}

const BuildPlanOf = computed.group("metadata:build-plan-of", async (target, gid) => {
	const [{ buildPlans }] = await target.need(BuildPlans)
	const plan = buildPlans[gid]
	if (!plan) fail(`Build plan for '${gid}' not found.` + whyBuildPlanIsnNotThere(gid))
	return plan
})

const GroupFontsOf = computed.group("metadata:group-fonts-of", async (target, gid) => {
	const [plan] = await target.need(BuildPlanOf(gid))
	return plan.targets
})

const CompositesFromBuildPlan = computed(`metadata:composites-from-build-plan`, async (target) => {
	const [{ buildPlans }] = await target.need(BuildPlans)
	let data = {}
	for (const bpn in buildPlans) {
		let bp = buildPlans[bpn]
		if (bp.variants) data[bpn] = bp.variants
	}
	return data
})

// eslint-disable-next-line complexity
const FontInfoOf = computed.group("metadata:font-info-of", async (target, fileName) => {
	const [{ fileNameToBpMap, buildPlans }] = await target.need(BuildPlans)
	const [version] = await target.need(Version)
	const fi0 = fileNameToBpMap[fileName]
	if (!fi0) fail(`Build plan for '${fileName}' not found.` + whyBuildPlanIsnNotThere(fileName))
	const bp = buildPlans[fi0.prefix]
	if (!bp) fail(`Build plan for '${fileName}' not found.` + whyBuildPlanIsnNotThere(fileName))
	const sfm = getSuffixMapping(bp.weights, bp.slopes, bp.widths)
	const sfi = sfm[fi0.suffix]
	const hintReferenceSuffix = fetchHintReferenceSuffix(sfm)
	let spacingDerive = null
	if (bp.spacingDeriveFrom)
		spacingDerive = {
			manner: bp.spacing,
			prefix: bp.spacingDeriveFrom,
			fileName: makeFileName(bp.spacingDeriveFrom, fi0.suffix),
		}
	return {
		name: fileName,
		variants: bp.variants || null,
		derivingVariants: bp.derivingVariants,
		buildCharMap: bp.buildCharMap,
		featureControl: {
			noCvSs: bp.noCvSs || false,
			noLigation: bp.noLigation || false,
			exportGlyphNames: bp.exportGlyphNames || false,
			buildTextureFeature: bp.buildTextureFeature || false,
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
			slopeAngle: sfi.shapeSlopeAngle,
		},
		// Menu
		menu: {
			family: bp.family,
			version: version,
			width: sfi.menuWidth,
			slope: sfi.menuSlope,
			weight: sfi.menuWeight,
		},
		// CSS
		css: {
			weight: sfi.cssWeight,
			stretch: sfi.cssStretch,
			style: sfi.cssStyle,
		},
		// Hinting
		hintParams: bp.hintParams || [],
		hintReference: !bp.metricOverride && hintReferenceSuffix !== fi0.suffix ? makeFileName(fi0.prefix, hintReferenceSuffix) : null,
		// Other parameters
		compatibilityLigatures: bp.compatibilityLigatures || null,
		metricOverride: bp.metricOverride || null,
		excludedCharRanges: bp.excludeChars?.ranges,
		// Spacing derivation -- creating faster build for spacing variants
		spacingDerive,
	}
})

function fetchHintReferenceSuffix(sfm) {
	if (sfm["regular"]) return "regular"
	let bestSuffix = null,
		bestSfi = null
	for (const [suffix, sfi] of Object.entries(sfm))
		if (!bestSfi || Math.abs(sfi.shapeWeight - 400) < Math.abs(bestSfi.shapeWeight - 400) || (Math.abs(sfi.shapeWeight - 400) === Math.abs(bestSfi.shapeWeight - 400) && Math.abs(sfi.shapeSlopeAngle) < Math.abs(bestSfi.shapeSlopeAngle)) || (Math.abs(sfi.shapeWeight - 400) === Math.abs(bestSfi.shapeWeight - 400) && Math.abs(sfi.shapeSlopeAngle) === Math.abs(bestSfi.shapeSlopeAngle) && Math.abs(sfi.shapeWidth - 500) < Math.abs(bestSfi.shapeWidth - 500))) {
			bestSuffix = suffix
			bestSfi = sfi
		}
	return bestSuffix
}

function getSuffixMapping(weights, slopes, widths) {
	const mapping = {}
	for (const w in weights) {
		validateRecommendedWeight(w, weights[w].menu, "Menu")
		validateRecommendedWeight(w, weights[w].css, "CSS")
		for (const s in slopes)
			for (const wd in widths) {
				const suffix = makeSuffix(w, wd, s, DEFAULT_SUBFAMILY)
				mapping[suffix] = getSuffixMappingItem(weights, w, slopes, s, widths, wd)
			}
	}
	return mapping
}
function getSuffixMappingItem(weights, w, slopes, s, widths, wd) {
	const weightDef = wwsDefValidate("Weight definition of " + s, weights[w])
	const widthDef = wwsDefValidate("Width definition of " + s, widths[wd])
	const slopeDef = wwsDefValidate("Slope definition of " + s, slopes[s])
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
		menuSlope: sValidate("Menu slope of " + s, slopeDef.menu, VlShapeSlope),
	}
}

function makeFileName(prefix, suffix) {
	return prefix + "-" + suffix
}
function makeSuffix(w, wd, s, fallback) {
	return (wd === WIDTH_NORMAL ? "" : wd + "-") + w + (s === SLOPE_NORMAL ? "" : "-" + s) || fallback
}

function whyBuildPlanIsnNotThere(gid) {
	if (!FS.existsSync(PRIVATE_BUILD_PLANS)) return "\n        -- Possible reason: Config file 'private-build-plans.toml' does not exist."
	return ""
}

///////////////////////////////////////////////////////////
//////                Font Building                  //////
///////////////////////////////////////////////////////////
const ageKey = uuid.v4()
const DistUnhintedTTF = file.make(
	(gr, fn) => `${DIST}/${gr}/ttf-unhinted/${fn}.ttf`,
	async (target, out, gr, fn) => {
		await target.need(Scripts, Parameters, Dependencies, de(out.dir))
		const [fi] = await target.need(FontInfoOf(fn))
		const charMapPath = file.getPathOf(BuildCM(gr, fn))
		const ttfaControlsPath = file.getPathOf(BuildTtfaControls(gr, fn))
		if (fi.spacingDerive) {
			// The font is a spacing variant, and is derivable form an existing
			// normally-spaced variant.
			const noGcTtfPath = file.getPathOf(BuildNoGcUnhintedTtfImpl(gr, fn))
			const spD = fi.spacingDerive
			const [deriveFrom] = await target.need(DistUnhintedTTF(spD.prefix, spD.fileName), de(charMapPath.dir))
			echo.action(echo.hl.command(`Create TTF`), out.full)
			await silently.node(`packages/font/src/derive-spacing.mjs`, {
				i: deriveFrom.full,
				o: out.full,
				paramsDir: Path.resolve("params"),
				oNoGc: noGcTtfPath.full,
				...fi,
			})
		} else {
			// Ab-initio build
			const cacheFileName = `${Math.round(1000 * fi.shape.weight)}-${Math.round(1000 * fi.shape.width)}-${Math.round(3600 * fi.shape.slopeAngle)}-${fi.shape.slope}`
			const cachePath = `${SHARED_CACHE}/${cacheFileName}.mpz`
			const cacheDiffPath = `${charMapPath.dir}/${fn}.cache.mpz`
			const [comps] = await target.need(CompositesFromBuildPlan, de(charMapPath.dir), de(ttfaControlsPath.dir), de(SHARED_CACHE))
			echo.action(echo.hl.command(`Create TTF`), out.full)
			const { cacheUpdated } = await silently.node("packages/font/src/index.mjs", {
				o: out.full,
				...(fi.buildCharMap ? { oCharMap: charMapPath.full } : {}),
				paramsDir: Path.resolve("params"),
				oTtfaControls: ttfaControlsPath.full,
				cacheFreshAgeKey: ageKey,
				iCache: cachePath,
				oCache: cacheDiffPath,
				compositesFromBuildPlan: comps,
				...fi,
			})
			if (cacheUpdated) {
				const lock = build.locks.alloc(cacheFileName)
				await lock.acquire()
				await silently.node(`packages/font/src/merge-cache.mjs`, {
					base: cachePath,
					diff: cacheDiffPath,
					version: fi.menu.version,
					freshAgeKey: ageKey,
				})
				lock.release()
			}
		}
	}
)

const BuildCM = file.make(
	(gr, f) => `${BUILD}/ttf/${gr}/${f}.charmap.mpz`,
	async (target, output, gr, f) => {
		await target.need(DistUnhintedTTF(gr, f))
	}
)
const BuildTtfaControls = file.make(
	(gr, f) => `${BUILD}/ttf/${gr}/${f}.ttfa.txt`,
	async (target, output, gr, f) => {
		await target.need(DistUnhintedTTF(gr, f))
	}
)
const BuildNoGcUnhintedTtfImpl = file.make(
	(gr, f) => `${BUILD}/ttf/${gr}/${f}.no-gc.ttf`,
	async (target, output, gr, f) => {
		await target.need(DistUnhintedTTF(gr, f))
	}
)
const BuildNoGcTtfImpl = file.make(
	(gr, f) => `${BUILD}/ttf/${gr}/${f}.no-gc.hinted.ttf`,
	async (target, output, gr, f) => {
		await target.need(DistHintedTTF(gr, f))
	}
)

const DistHintedTTF = file.make(
	(gr, fn) => `${DIST}/${gr}/ttf/${fn}.ttf`,
	async (target, out, gr, fn) => {
		const [fi, hint] = await target.need(FontInfoOf(fn), CheckTtfAutoHintExists, de`${out.dir}`)
		if (fi.spacingDerive) {
			// The font is a spacing variant, and is derivable form an existing
			// normally-spaced variant.
			const spD = fi.spacingDerive
			const noGcTtfPath = file.getPathOf(BuildNoGcTtfImpl(gr, fn))
			const [deriveFrom] = await target.need(DistHintedTTF(spD.prefix, spD.fileName), de(noGcTtfPath.dir))
			echo.action(echo.hl.command(`Hint TTF`), out.full)
			await silently.node(`packages/font/src/derive-spacing.mjs`, {
				i: deriveFrom.full,
				oNoGc: noGcTtfPath.full,
				o: out.full,
				paramsDir: Path.resolve("params"),
				...fi,
			})
		} else {
			const [from, ttfaControls] = await target.need(DistUnhintedTTF(gr, fn), BuildTtfaControls(gr, fn))
			echo.action(echo.hl.command(`Hint TTF`), out.full, echo.hl.operator("<-"), from.full)
			await silently.run(hint, fi.hintParams, "-m", ttfaControls.full, from.full, out.full)
		}
	}
)

const BuildNoGcTtf = task.make(
	(gr, fn) => `BuildNoGcTtf::${gr}/${fn}`,
	async (target, gr, fn) => {
		const [fi] = await target.need(FontInfoOf(fn))
		if (fi.spacingDerive) {
			const [noGc] = await target.need(BuildNoGcTtfImpl(gr, fn))
			return noGc
		} else {
			const [distUnhinted] = await target.need(DistHintedTTF(gr, fn))
			return distUnhinted
		}
	}
)

function formatSuffix(fmt, unhinted) {
	return fmt + (unhinted ? "-unhinted" : "")
}
const DistWoff2 = file.make(
	(gr, fn, unhinted) => `${DIST}/${gr}/${formatSuffix("woff2", unhinted)}/${fn}.woff2`,
	async (target, out, group, f, unhinted) => {
		const Ctor = unhinted ? DistUnhintedTTF : DistHintedTTF
		const [from] = await target.need(Ctor(group, f), de`${out.dir}`)
		echo.action(echo.hl.command("Create WOFF2"), out.full, echo.hl.operator("<-"), from.full)
		await silently.node(`tools/misc/src/ttf-to-woff2.mjs`, from.full, out.full)
	}
)

///////////////////////////////////////////////////////////
//////              Font Distribution                //////
///////////////////////////////////////////////////////////
// Group-level entry points
const Entry_GroupContents = task.group("contents", async (target, gr) => {
	await target.need(Entry_GroupFonts(gr), Entry_GroupUnhintedFonts(gr))
	return gr
})
const Entry_GroupTTFs = task.group("ttf", async (target, gr) => {
	await target.need(GroupTtfsImpl(gr, false))
})
const Entry_GroupUnhintedTTFs = task.group("ttf-unhinted", async (target, gr) => {
	await target.need(GroupTtfsImpl(gr, true))
})
const Entry_GroupWoff2s = task.group("woff2", async (target, gr) => {
	await target.need(GroupWoff2Impl(gr, false))
})
const Entry_GroupUnhintedWoff2s = task.group("woff2-unhinted", async (target, gr) => {
	await target.need(GroupWoff2Impl(gr, true))
})
const Entry_GroupWebFonts = task.group("webfont", async (target, gr) => {
	await target.need(GroupWebFontsImpl(gr, false))
})
const Entry_GroupUnhintedWebFonts = task.group("webfont-unhinted", async (target, gr) => {
	await target.need(GroupWebFontsImpl(gr, true))
})
const Entry_GroupFonts = task.group("fonts", async (target, gr) => {
	await target.need(GroupTtfsImpl(gr, false), GroupWebFontsImpl(gr, false))
})
const Entry_GroupUnhintedFonts = task.group("fonts-unhinted", async (target, gr) => {
	await target.need(GroupTtfsImpl(gr, true), GroupWebFontsImpl(gr, true))
})

// Webfont CSS
const DistWebFontCSS = file.make(
	(gr, unhinted) => `${DIST}/${gr}/${formatSuffix(gr, unhinted)}.css`,
	async (target, out, gr, unhinted) => {
		const [plan] = await target.need(BuildPlanOf(gr))
		await target.need(de(out.dir))
		await createWebFontCssImpl(target, out.full, gr, plan.webfontFormats, unhinted)
	}
)
async function createWebFontCssImpl(target, output, gr, formats, unhinted) {
	const [bp, ts] = await target.need(BuildPlanOf(gr), GroupFontsOf(gr))
	const hs = await target.need(...ts.map(FontInfoOf))
	echo.action(echo.hl.command(`Create WebFont CSS`), output, echo.hl.operator("<-"), gr)
	await silently.node("tools/misc/src/make-webfont-css.mjs", output, bp.family, hs, formats, unhinted)
}

// Content files
const GroupTtfsImpl = task.make(
	(gr, unhinted) => `group-${formatSuffix("TTFImpl", unhinted)}::${gr}`,
	async (target, gr, unhinted) => {
		const Ctor = unhinted ? DistUnhintedTTF : DistHintedTTF
		const [ts] = await target.need(GroupFontsOf(gr))
		await target.need(ts.map((tn) => Ctor(gr, tn)))
		return gr
	}
)
const GroupWoff2Impl = task.make(
	(gr, unhinted) => `group-${formatSuffix("WOFF2Impl", unhinted)}::${gr}`,
	async (target, gr, unhinted) => {
		const [ts] = await target.need(GroupFontsOf(gr))
		await target.need(ts.map((tn) => DistWoff2(gr, tn, unhinted)))
		return gr
	}
)
const GroupWebFontsImpl = task.make(
	(gr, unhinted) => `group-${formatSuffix("WebFontImpl", unhinted)}::${gr}`,
	async (target, gr, unhinted) => {
		const [bp] = await target.need(BuildPlanOf(gr))
		const groupsNeeded = []
		for (const ext of bp.webfontFormats) {
			switch (`${ext}`.toUpperCase()) {
				case "TTF":
					groupsNeeded.push(GroupTtfsImpl(gr, unhinted))
					break
				case "WOFF2":
					groupsNeeded.push(GroupWoff2Impl(gr, unhinted))
					break
			}
		}
		await target.need(groupsNeeded, DistWebFontCSS(gr, unhinted))
		return gr
	}
)

///////////////////////////////////////////////////////////
//////            Font Collection Plans              //////
///////////////////////////////////////////////////////////
const CollectPlans = computed(`metadata:collect-plans`, async (target) => {
	const [rawPlans] = await target.need(RawPlans)
	return await getCollectPlans(target, rawPlans.collectPlans)
})

// eslint-disable-next-line complexity
async function getCollectPlans(target, rawCollectPlans) {
	const plans = {}
	let allCollectableGroups = new Set()
	for (const collectPrefix in rawCollectPlans) {
		const collect = rawCollectPlans[collectPrefix]
		if (!collect.release) continue
		for (const gr of collect.from) allCollectableGroups.add(gr)
	}
	const amendedRawCollectPlans = { ...rawCollectPlans }
	out: for (const gr of allCollectableGroups) {
		for (const [k, cp] of Object.entries(rawCollectPlans)) if (cp.from.length === 1 && cp.from[0] === gr) continue out
		amendedRawCollectPlans[`SGr-` + gr] = { release: true, isAmended: true, from: [gr] }
	}
	for (const collectPrefix in amendedRawCollectPlans) {
		const glyfTtcComposition = {}
		const ttcComposition = {}
		const collect = amendedRawCollectPlans[collectPrefix]
		if (!collect || !collect.from || !collect.from.length) continue
		for (const prefix of collect.from) {
			const [gri] = await target.need(BuildPlanOf(prefix))
			const ttfFileNameSet = new Set(gri.targets)
			const suffixMap = getSuffixMapping(gri.weights, gri.slopes, gri.widths)
			for (const suffix in suffixMap) {
				const sfi = suffixMap[suffix]
				const ttfTargetName = makeFileName(prefix, suffix)
				if (!ttfFileNameSet.has(ttfTargetName)) continue
				const glyfTtcFileName = fnStandardTtc(true, collectPrefix, suffixMap, sfi)
				if (!glyfTtcComposition[glyfTtcFileName]) glyfTtcComposition[glyfTtcFileName] = []
				glyfTtcComposition[glyfTtcFileName].push({ dir: prefix, file: ttfTargetName })
				const ttcFileName = fnStandardTtc(false, collectPrefix, suffixMap, sfi)
				if (!ttcComposition[ttcFileName]) ttcComposition[ttcFileName] = []
				ttcComposition[ttcFileName].push(glyfTtcFileName)
			}
		}
		plans[collectPrefix] = {
			glyfTtcComposition,
			ttcComposition,
			groupDecomposition: [...collect.from],
			inRelease: !!collect.release,
			isAmended: !!collect.isAmended,
		}
	}
	return plans
}

function fnStandardTtc(fIsGlyfTtc, prefix, suffixMapping, sfi) {
	let optimalSfi = null,
		maxScore = 0
	for (const ttcSuffix in suffixMapping) {
		const sfiT = suffixMapping[ttcSuffix]
		if (sfi.shapeWeight !== sfiT.shapeWeight) continue
		if (fIsGlyfTtc && sfi.shapeWidth !== sfiT.shapeWidth) continue
		if (fIsGlyfTtc && sfi.shapeSlopeAngle !== sfiT.shapeSlopeAngle) continue
		const score = (sfiT.weight === WEIGHT_NORMAL ? 1 : 0) + (sfiT.width === WIDTH_NORMAL ? 1 : 0) + (sfiT.slope === SLOPE_NORMAL ? 1 : 0)
		if (!optimalSfi || score > maxScore) {
			maxScore = score
			optimalSfi = sfiT
		}
	}
	if (!optimalSfi) throw new Error("Unreachable: TTC name decision")
	return `${prefix}-${makeSuffix(optimalSfi.weight, optimalSfi.width, optimalSfi.slope, DEFAULT_SUBFAMILY)}`
}

///////////////////////////////////////////////////////////
//////               Font Collection                 //////
///////////////////////////////////////////////////////////
const SpecificTtc = task.group(`ttc-glyf`, async (target, cgr) => {
	const [cPlan] = await target.need(CollectPlans)
	const ttcFiles = Array.from(Object.keys(cPlan[cgr].ttcComposition))
	await target.need(ttcFiles.map((pt) => CollectedTtcFile(cgr, pt)))
})
const SpecificSuperTtc = task.group(`ttc`, async (target, cgr) => {
	await target.need(CollectedSuperTtcFile(cgr))
})

const CollectedSuperTtcFile = file.make(
	(cgr) => `${DIST}/${cgr}/${cgr}.ttc`,
	async (target, out, cgr) => {
		const [cp] = await target.need(CollectPlans, de(out.dir))
		const parts = Array.from(Object.keys(cp[cgr].glyfTtcComposition))
		const [inputs] = await target.need(parts.map((pt) => GlyfTtc(cgr, pt)))
		await buildCompositeTtc(out, inputs)
	}
)
const CollectedTtcFile = file.make(
	(cgr, f) => `${DIST}/${cgr}/ttc/${f}.ttc`,
	async (target, out, cgr, f) => {
		const [cp] = await target.need(CollectPlans, de`${out.dir}`)
		const parts = Array.from(new Set(cp[cgr].ttcComposition[f]))
		const [inputs] = await target.need(parts.map((pt) => GlyfTtc(cgr, pt)))
		await buildCompositeTtc(out, inputs)
	}
)
const GlyfTtc = file.make(
	(cgr, f) => `${GLYF_TTC}/${cgr}/${f}.ttc`,
	async (target, out, cgr, f) => {
		const [cp] = await target.need(CollectPlans)
		const parts = cp[cgr].glyfTtcComposition[f]
		await buildGlyphSharingTtc(target, parts, out)
	}
)

async function buildCompositeTtc(out, inputs) {
	const inputPaths = inputs.map((f) => f.full)
	echo.action(echo.hl.command(`Create TTC`), out.full, echo.hl.operator("<-"), inputPaths)
	await absolutelySilently.run(MAKE_TTC, ["-o", out.full], inputPaths)
}

async function buildGlyphSharingTtc(target, parts, out) {
	await target.need(de`${out.dir}`)
	const [ttfInputs] = await target.need(parts.map((part) => BuildNoGcTtf(part.dir, part.file)))
	const ttfInputPaths = ttfInputs.map((p) => p.full)
	echo.action(echo.hl.command(`Create TTC`), out.full, echo.hl.operator("<-"), ttfInputPaths)
	await silently.run(MAKE_TTC, "-u", ["-o", out.full], ttfInputPaths)
}

///////////////////////////////////////////////////////////
//////                   Entries                     //////
///////////////////////////////////////////////////////////
const Clean = task(`clean`, async () => {
	await rm(BUILD)
	build.deleteJournal()
})

const FullClean = task(`full-clean`, async () => {
	await rm(BUILD)
	await rm(DIST)
	build.deleteJournal()
})

///////////////////////////////////////////////////////////
//////               Script Building                 //////
///////////////////////////////////////////////////////////
const MARCOS = [fu`packages/font-glyphs/src/meta/macros.ptl`, fu`packages/font-otl/src/meta/macros.ptl`]
const ScriptsUnder = oracle.make(
	(ext, dir) => `${ext}-scripts-under::${dir}`,
	(target, ext, dir) => FileList({ under: dir, pattern: `**/*.${ext}` })(target)
)
const UtilScriptFiles = computed("util-script-files", async (target) => {
	const [mjs, md] = await target.need(ScriptsUnder("mjs", "tools"), ScriptsUnder("md", "tools"))
	return [...mjs, ...md]
})
const ScriptFiles = computed.group("script-files", async (target, ext) => {
	const [ss] = await target.need(ScriptsUnder(ext, `packages`))
	return ss
})
const JavaScriptFromPtl = computed("scripts-js-from-ptl", async (target) => {
	const [ptl] = await target.need(ScriptFiles("ptl"))
	return ptl.map((x) => replaceExt(".mjs", x))
})
function replaceExt(extNew, file) {
	return Path.posix.join(Path.dirname(file), Path.basename(file, Path.extname(file)) + extNew)
}

const CompiledJs = file.make(
	(p) => p,
	async (target, out) => {
		const ptl = replaceExt(".ptl", out.full)
		if (/\/glyphs\//.test(out.full)) await target.need(MARCOS)
		await target.need(sfu(ptl))
		echo.action(echo.hl.command("Compile Script"), ptl)
		await silently.run(PATEL_C, "--strict", "--esm", ptl, "-o", out.full)
	}
)
const Scripts = task("scripts", async (target) => {
	const [jsFromPtlList] = await target.need(JavaScriptFromPtl)
	const [jsList] = await target.need(ScriptFiles("mjs"))
	const jsFromPtlSet = new Set(jsFromPtlList)
	let subGoals = []
	for (const js of jsFromPtlSet) subGoals.push(CompiledJs(js))
	for (const js of jsList) if (!jsFromPtlSet.has(js)) subGoals.push(sfu(js))
	await target.need(subGoals)
})
const UtilScripts = task("util-scripts", async (target) => {
	const [files] = await target.need(UtilScriptFiles)
	await target.need(files.map(fu))
})

const Parameters = task(`meta:parameters`, async (target) => {
	await target.need(Version, sfu`params/parameters.toml`, sfu`params/shape-weight.toml`, sfu`params/shape-width.toml`, sfu`params/shape-slope.toml`, ofu`params/private-parameters.toml`, sfu`params/variants.toml`, sfu`params/ligation-set.toml`)
})

///////////////////////////////////////////////////////////
//////              Config Validation                //////
///////////////////////////////////////////////////////////
// Build plan validation
function validateBuildPlan(prefix, bp) {
	if (!bp.family) fail(`Build plan for ${prefix} does not have a family name. Exit.`)
	failWithLegacyParamName(prefix, bp, `no-cv-ss`, `noCvSs`)
	failWithLegacyParamName(prefix, bp, `no-ligation`, `noLigation`)
	failWithLegacyParamName(prefix, bp, `export-glyph-names`, `exportGlyphNames`)
	failWithLegacyParamName(prefix, bp, `build-texture-feature`, `buildTextureFeature`)
	failWithLegacyParamName(prefix, bp, `metric-override`, `metricOverride`)
	failWithLegacyParamName(prefix, bp, `compatibility-ligatures`, `compatibilityLigatures`)
	failWithLegacyParamName(prefix, bp, `exclude-chars`, `excludeChars`)
}

function failWithLegacyParamName(prefix, bp, legacy, expected) {
	if (bp[legacy]) fail(`Build plan for '${prefix}' contains legacy build parameter '${legacy}'. Please use '${expected}' instead.`)
}

function resolveWws(bpName, buildPlans, defaultConfig) {
	const bp = buildPlans[bpName]
	if (!bp) fail(`Build plan ${bpName} not found.`)
	if (!bp.slopes && bp.slants) fail(`Build plan for ${bpName} uses legacy "slants" to define slopes. Use "slopes" instead.`)
	bp.weights = resolveWwsAspect("weights", bpName, buildPlans, defaultConfig, [])
	bp.widths = resolveWwsAspect("widths", bpName, buildPlans, defaultConfig, [])
	bp.slopes = resolveWwsAspect("slopes", bpName, buildPlans, defaultConfig, [])
}

function resolveWwsAspect(aspectName, bpName, buildPlans, defaultConfig, deps) {
	const bp = buildPlans[bpName]
	if (!bp) fail(`Build plan ${bpName} not found.`)
	if (bp[aspectName]) return shimBpAspect(aspectName, bp[aspectName], defaultConfig[aspectName])
	else if (bp[`${aspectName}-inherits`]) {
		const inheritedPlanName = bp[`${aspectName}-inherits`]
		const inheritedPlan = buildPlans[inheritedPlanName]
		if (deps.includes(inheritedPlan)) fail(`Circular dependency detected when resolving ${aspectName} of ${bp.family}.`)
		const updatedDes = [...deps, bpName]
		return resolveWwsAspect(aspectName, inheritedPlanName, buildPlans, defaultConfig, updatedDes)
	} else return defaultConfig[aspectName]
}

function shimBpAspect(aspectName, aspect, defaultAspect) {
	if (!aspect) return defaultAspect
	const result = {}
	for (const [k, v] of Object.entries(aspect)) shimBpAspectKey(aspectName, result, k, v, defaultAspect)
	return result
}
function shimBpAspectKey(aspectName, sink, k, v, defaultAspect) {
	if (typeof v === "string") {
		if (!/^default\./.test(v)) throw new Error(`Invalid configuration '${v}' for ${aspectName}.${k}'`)
		const remappingKey = v.slice("default.".length)
		if (!defaultAspect[remappingKey]) throw new Error(`Invalid configuration '${v}' for ${aspectName}.${k}'`)
		sink[k] = defaultAspect[remappingKey]
	} else sink[k] = v
}

// Recommended weight validation
function validateRecommendedWeight(w, value, label) {
	const RecommendedMenuWeights = {
		thin: 100,
		extralight: 200,
		light: 300,
		semilight: 350,
		regular: 400,
		book: 450,
		medium: 500,
		semibold: 600,
		bold: 700,
		extrabold: 800,
		black: 900,
	}
	if (RecommendedMenuWeights[w] && RecommendedMenuWeights[w] !== value) echo.warn(`${label} weight settings of ${w} ( = ${value}) doesn't match the recommended value ( = ${RecommendedMenuWeights[w]}).`)
}

// Value validation
function wwsDefValidate(key, obj) {
	if (!obj || typeof obj === "string") throw new TypeError(`${key} is invalid.`)
	return obj
}

function nValidate(key, v, validator) {
	if (validator.fixup) v = validator.fix(v)
	if (typeof v !== "number" || !isFinite(v) || !validator.validate(v)) throw new TypeError(`${key} = ${v} is not a valid number.`)
	return v
}

const VlShapeWeight = { validate: (x) => x >= 100 && x <= 1000 }
const VlCssWeight = { validate: (x) => x > 0 && x <= 1000 }
const VlMenuWeight = VlCssWeight
const g_widthFixupMemory = new Map()
const VlShapeWidth = {
	validate: (x) => x >= 416 && x <= 720,
	fix(x) {
		if (x >= 3 && x <= 9) {
			if (g_widthFixupMemory.has(x)) return g_widthFixupMemory.get(x)
			const xCorrected = Math.round(500 * Math.pow(Math.sqrt(600 / 500), x - 5))
			echo.warn(`The build plan is using legacy width grade ${x}. Converting to unit width ${xCorrected}.`)
			g_widthFixupMemory.set(x, xCorrected)
			return xCorrected
		} else return x
	},
}
const VlMenuWidth = { validate: (x) => x >= 1 && x <= 9 && x % 1 === 0 }
const VlSlopeAngle = { validate: (x) => x >= 0 && x <= 15 }

function sValidate(key, v, validator) {
	if (validator.fixup) v = validator.fix(v)
	if (typeof v !== "string" || !validator.validate(v)) throw new TypeError(`${key} = ${v} is not a valid string.`)
	return v
}
const VlShapeSlope = { validate: (x) => x === "upright" || x === "oblique" || x === "italic" }
const VlCssStyle = { validate: (x) => x === "normal" || x === "oblique" || x === "italic" }
const VlCssFontStretch = {
	validate: (x) => x == "ultra-condensed" || x == "extra-condensed" || x == "condensed" || x == "semi-condensed" || x == "normal" || x == "semi-expanded" || x == "expanded" || x == "extra-expanded" || x == "ultra-expanded",
}

// Utilities
function Delay(t) {
	return new Promise((resolve) => setTimeout(resolve, t))
}
