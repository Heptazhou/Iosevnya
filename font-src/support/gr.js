"use strict";

const crypto = require("crypto");

const Dotless = {
	tag: "dtls",
	get(glyph) {
		if (glyph && glyph.related) return glyph.related.dotless;
		else return null;
	},
	set(glyph, toGid) {
		if (typeof toGid !== "string") throw new Error("Must supply a GID instead of a glyph");
		if (!glyph.related) glyph.related = {};
		glyph.related.dotless = toGid;
	},
	amendName(name) {
		return name + ".dotless";
	}
};

function SimpleProp(key) {
	return {
		get(glyph) {
			if (glyph && glyph.related) return glyph.related[key];
			else return null;
		},
		set(glyph, toGid) {
			if (typeof toGid !== "string") throw new Error("Must supply a GID instead of a glyph");
			if (!glyph.related) glyph.related = {};
			glyph.related[key] = toGid;
		}
	};
}

const LowerYDotAtBelow = SimpleProp("LowerYDotAtBelow");
const RightDependentTrigger = SimpleProp("RightDependentTrigger");
const MathSansSerif = SimpleProp("MathSansSerif");

function DependentLinkProp(key) {
	return {
		get(glyph, subKey) {
			if (glyph && glyph.related && glyph.related[key]) {
				return glyph.related[key][subKey];
			} else {
				return null;
			}
		},
		getAll(glyph) {
			if (glyph && glyph.related) return glyph.related[key];
			else return null;
		},
		set(glyph, subKey, toGid) {
			if (typeof toGid !== "string") throw new Error("Must supply a GID instead of a glyph");
			if (!glyph.related) glyph.related = {};
			if (!glyph.related[key]) glyph.related[key] = {};
			glyph.related[key][subKey] = toGid;
		}
	};
}

const RightDependentLink = DependentLinkProp("RightDependentLink");

function OtlTaggedProp(key, otlTag) {
	return { ...SimpleProp(key), otlTag };
}

const Nwid = OtlTaggedProp("Nwid", "NWID");
const Wwid = OtlTaggedProp("Wwid", "WWID");
const Lnum = OtlTaggedProp("Lnum", "lnum");
const Onum = OtlTaggedProp("Onum", "onum");
const AplForm = OtlTaggedProp("AplForm", "APLF");
const NumeratorForm = OtlTaggedProp("Numerator", "numr");
const DenominatorForm = OtlTaggedProp("Denominator", "dnom");

function DecompositionProp(key) {
	return {
		get(glyph) {
			if (glyph && glyph.related) return glyph.related[key];
			else return null;
		},
		set(glyph, composition) {
			if (!Array.isArray(composition)) throw new Error("Must supply a GID array");
			if (!glyph.related) glyph.related = {};
			glyph.related[key] = composition;
		}
	};
}

const CvDecompose = DecompositionProp("CvDecompose");
const PseudoCvDecompose = DecompositionProp("PseudoCvDecompose");
const CcmpDecompose = DecompositionProp("CcmpDecompose");

const TieMark = {
	tag: "TMRK",
	get(glyph) {
		if (glyph && glyph.related) return glyph.related.TieMark;
		else return null;
	},
	set(glyph, toGid) {
		if (typeof toGid !== "string") throw new Error("Must supply a GID instead of a glyph");
		if (!glyph.related) glyph.related = {};
		glyph.related.TieMark = toGid;
	},
	amendName(name) {
		return `TieMark{${name}}`;
	},
	amendOtName(name) {
		return name + ".tieMark";
	}
};

const TieGlyph = {
	get(glyph) {
		if (glyph && glyph.related) return glyph.related.TieGlyph;
		else return null;
	},
	set(glyph) {
		if (!glyph.related) glyph.related = {};
		glyph.related.TieGlyph = true;
		Joining.or(glyph, Joining.Classes.Mid);
	}
};

const Radical = {
	get(glyph) {
		if (glyph && glyph.related) return !!glyph.related.radical;
		else return false;
	},
	set(glyph) {
		if (!glyph.related) glyph.related = {};
		glyph.related.radical = true;
	}
};

const RequireCcmpDecompose = {
	get(glyph) {
		if (glyph && glyph.related) return !!glyph.related.RequireCcmpDecompose;
		else return false;
	},
	set(glyph) {
		if (!glyph.related) glyph.related = {};
		glyph.related.RequireCcmpDecompose = true;
	}
};

const Joining = {
	get(glyph) {
		if (glyph && glyph.related) return glyph.related.joining || 0;
		else return 0;
	},
	set(glyph, cls) {
		if (!glyph.related) glyph.related = {};
		glyph.related.joining = cls;
	},
	or(glyph, cls) {
		Joining.set(glyph, cls | Joining.get(cls));
	},
	amendOtName(baseName, cl) {
		switch (cl) {
			case Joining.Classes.Left:
				return `${baseName}.join-l`;
			case Joining.Classes.Right:
				return `${baseName}.join-r`;
			case Joining.Classes.Mid:
				return `${baseName}.join-m`;
			default:
				return baseName;
		}
	},
	Classes: {
		Left: 1,
		Right: 2,
		Mid: 3
	}
};

const CvTagCache = new Map();
function Cv(tag, rank) {
	const key = tag + "#" + rank;
	if (CvTagCache.has(key)) return CvTagCache.get(key);
	const rel = {
		tag,
		rank,
		get(glyph) {
			if (glyph && glyph.related && glyph.related.cv) return glyph.related.cv[key];
			else return null;
		},
		set(glyph, toGid) {
			if (typeof toGid !== "string") throw new Error("Must supply a GID instead of a glyph");
			if (!glyph.related) glyph.related = {};
			if (!glyph.related.cv) glyph.related.cv = {};
			glyph.related.cv[key] = toGid;
		},
		getPreventDeriving(glyph) {
			return (
				glyph.related &&
				glyph.related.preventCvDeriving &&
				!!glyph.related.preventCvDeriving[key]
			);
		},
		setPreventDeriving(glyph) {
			if (!glyph.related) glyph.related = {};
			if (!glyph.related.preventCvDeriving) glyph.related.preventCvDeriving = {};
			glyph.related.preventCvDeriving[key] = true;
		},
		amendName(name) {
			return name + "." + key;
		},
		amendOtName(name) {
			return name + "." + tag + "-" + rank;
		}
	};
	CvTagCache.set(key, rel);
	return rel;
}

const DotlessOrNot = {
	query(glyph) {
		if (Dotless.get(glyph)) return [Dotless];
		return null;
	}
};

const AnyCv = {
	query(glyph) {
		let ret = [];
		if (glyph && glyph.related && glyph.related.cv) {
			for (const key in glyph.related.cv) {
				const [tag, rankStr] = key.split("#");
				const rank = parseInt(rankStr, 10);
				const rel = Cv(tag, rank);
				if (rel.get(glyph)) ret.push(rel);
			}
		}
		return ret;
	}
};

const AnyDerivingCv = {
	query(glyph) {
		let ret = [];
		if (glyph && glyph.related && glyph.related.cv) {
			for (const key in glyph.related.cv) {
				if (glyph.related.preventCvDeriving && glyph.related.preventCvDeriving[key])
					continue;
				const [tag, rankStr] = key.split("#");
				const rank = parseInt(rankStr, 10);
				const rel = Cv(tag, rank);
				if (rel.get(glyph)) ret.push(rel);
			}
		}
		return ret;
	},
	hasNonDerivingVariants(glyph) {
		if (glyph && glyph.related && glyph.related.cv) {
			for (const key in glyph.related.cv) {
				if (glyph.related.preventCvDeriving && glyph.related.preventCvDeriving[key])
					return true;
			}
		}
		return false;
	}
};

function getGrTreeImpl(gid, grSetList, fnGidToGlyph, sink) {
	if (!grSetList.length) return;
	const g = fnGidToGlyph(gid);
	if (!g) return;

	const grs = grSetList[0].query(g);

	getGrTreeImpl(gid, grSetList.slice(1), fnGidToGlyph, sink);
	if (grs && grs.length) {
		for (const gr of grs) {
			sink.push([gr, gid, gr.get(g)]);
			getGrTreeImpl(gr.get(g), grSetList, fnGidToGlyph, sink);
		}
	}
}
function getGrTree(gid, grSetList, fnGidToGlyph) {
	if (typeof gid !== "string") throw new TypeError("Must supply a GID");
	let sink = [];
	getGrTreeImpl(gid, grSetList, fnGidToGlyph, sink);
	return sink;
}

function gidListSame(a, b) {
	for (let j = 0; j < a.length; j++) {
		if (a[j] !== b[j]) return false;
	}
	return true;
}
function gidListMap(gidList, gr, fnGidToGlyph) {
	let effective = false;
	const gidList1 = gidList.slice(0);
	for (let j = 0; j < gidList1.length; j++) {
		const g = fnGidToGlyph(gidList[j]);
		if (g && gr.get(g)) {
			gidList1[j] = gr.get(g);
			effective = true;
		}
	}
	if (effective) return gidList1;
	else return null;
}

function collectGidLists(gidListOrig, gidList, grl, excluded, fnGidToGlyph, sink) {
	if (!grl.length) {
		sink.push(gidList);
		return;
	} else {
		const gr = grl[0],
			grlRest = grl.slice(1);
		collectGidLists(gidListOrig, gidList, grlRest, excluded, fnGidToGlyph, sink);
		if (gr !== excluded) {
			const gidList1 = gidListMap(gidList, gr, fnGidToGlyph);
			if (gidList1 && !gidListSame(gidList, gidList1))
				collectGidLists(gidListOrig, gidList1, grlRest, excluded, fnGidToGlyph, sink);
		}
	}
}

function getGrMesh(gidList, grq, fnGidToGlyph) {
	if (typeof gidList === "string" || !Array.isArray(gidList))
		throw new TypeError(`glyphs must be a glyph array!`);

	const allGrSet = new Set();
	for (const g of gidList) {
		for (const gr of grq.query(fnGidToGlyph(g))) allGrSet.add(gr);
	}

	const allGrList = Array.from(allGrSet);
	let ret = [];
	for (const gr of allGrList) {
		const col = [];
		collectGidLists(gidList, gidList, allGrList, gr, fnGidToGlyph, col);
		if (!col.length) continue;
		for (const from of col) {
			const to = gidListMap(from, gr, fnGidToGlyph);
			if (to && !gidListSame(from, to)) {
				ret.push([gr, from, to]);
			}
		}
	}

	return ret;
}

function createGrDisplaySheet(glyphStore, gid) {
	const glyph = glyphStore.queryByName(gid);
	if (!glyph) return [];

	// Query selected typographic features -- mostly NWID and WWID
	let typographicFeatures = [];
	displayQueryPairFeatures(glyphStore, gid, Nwid, Wwid, typographicFeatures);
	displayQueryPairFeatures(glyphStore, gid, Lnum, Onum, typographicFeatures);
	displayQuerySingleFeature(glyphStore, gid, AplForm, typographicFeatures);

	let charVariantFeatures = [];
	const decomposition = CvDecompose.get(glyph) || PseudoCvDecompose.get(glyph);
	if (decomposition) {
		const variantAssignmentSet = new Set();
		for (const componentGn of decomposition) {
			const component = glyphStore.queryByName(componentGn);
			if (!component) continue;
			queryCvFeatureTagsOf(charVariantFeatures, componentGn, component, variantAssignmentSet);
		}
	} else {
		queryCvFeatureTagsOf(charVariantFeatures, gid, glyph, null);
	}

	return [typographicFeatures, charVariantFeatures];
}
function displayQueryPairFeatures(gs, gid, grCis, grTrans, sink) {
	const g = gs.queryByName(gid);
	if (!g) return;
	const glyphIsHidden = /^\./.test(gid);
	if (glyphIsHidden) return;
	if (grCis.get(g) || grTrans.get(g)) {
		sink.push(`'${grCis.otlTag}' 1`, `'${grTrans.otlTag}' 1`);
	}
}
function displayQuerySingleFeature(gs, gid, grCis, sink) {
	const g = gs.queryByName(gid);
	if (!g) return;
	const glyphIsHidden = /^\./.test(gid);
	if (glyphIsHidden) return;
	if (grCis.get(g)) {
		sink.push(`'${grCis.otlTag}' 0`, `'${grCis.otlTag}' 1`);
	}
}

function byTagPreference(a, b) {
	const ua = a.tag.toUpperCase(),
		ub = b.tag.toUpperCase();
	if (ua < ub) return -1;
	if (ua > ub) return 1;
	return 0;
}
function queryCvFeatureTagsOf(sink, gid, glyph, variantAssignmentSet) {
	const cvs = AnyCv.query(glyph).sort(byTagPreference);
	let existingGlyphs = new Set();
	let m = new Map();
	for (const gr of cvs) {
		const tag = gr.tag;
		const target = gr.get(glyph);
		if (target === gid) continue;
		if (existingGlyphs.has(target)) continue;
		existingGlyphs.add(target);

		let g = m.get(tag);
		if (!g) {
			g = [];
			m.set(tag, g);
		}

		const assignCss = `'${tag}' ${gr.rank}`;
		if (!variantAssignmentSet) {
			g.push(assignCss);
		} else if (!variantAssignmentSet.has(assignCss)) {
			g.push(assignCss);
			variantAssignmentSet.add(assignCss);
		}
	}
	for (const g of m.values()) if (g.length) sink.push(g);
}

function linkSuffixGr(gs, suffix, gr) {
	const reSuffix = new RegExp("\\." + suffix + "$");
	for (const [gnSuffixed, gSuffixed] of gs.namedEntries()) {
		if (reSuffix.test(gnSuffixed) && !/^\./.test(gnSuffixed)) {
			const gnOriginal = gnSuffixed.replace(reSuffix, "");
			const gOriginal = gs.queryByName(gnOriginal);
			if (!gOriginal) continue;
			gr.set(gOriginal, gnSuffixed);
		}
	}
}
function linkSuffixPairGr(gs, tagCis, tagTrans, grCis, grTrans) {
	const reTagCis = new RegExp("\\." + tagCis + "$");
	for (const [gnCis, gCis] of gs.namedEntries()) {
		if (reTagCis.test(gnCis) && !/^\./.test(gnCis)) {
			const gnTrans = gnCis.replace(reTagCis, "." + tagTrans);
			const gTrans = gs.queryByName(gnTrans);
			if (!gTrans) continue;
			grTrans.set(gCis, gnTrans);
			grCis.set(gTrans, gnCis);
		}
	}
}

function hashCv(g) {
	const hasher = crypto.createHash("sha256");
	for (const gr of AnyCv.query(g)) {
		hasher.update(`${gr.tag}/${gr.rank}:${gr.get(g)}\n`);
	}
	return hasher.digest("hex");
}

exports.Dotless = Dotless;
exports.LowerYDotAtBelow = LowerYDotAtBelow;
exports.Cv = Cv;
exports.AnyCv = AnyCv;
exports.DotlessOrNot = DotlessOrNot;
exports.getGrTree = getGrTree;
exports.getGrMesh = getGrMesh;
exports.TieMark = TieMark;
exports.TieGlyph = TieGlyph;
exports.Radical = Radical;
exports.RequireCcmpDecompose = RequireCcmpDecompose;
exports.Joining = Joining;
exports.AnyDerivingCv = AnyDerivingCv;
exports.CcmpDecompose = CcmpDecompose;
exports.CvDecompose = CvDecompose;
exports.PseudoCvDecompose = PseudoCvDecompose;
exports.RightDependentLink = RightDependentLink;
exports.RightDependentTrigger = RightDependentTrigger;
exports.MathSansSerif = MathSansSerif;
exports.Nwid = Nwid;
exports.Wwid = Wwid;
exports.Lnum = Lnum;
exports.Onum = Onum;
exports.AplForm = AplForm;
exports.NumeratorForm = NumeratorForm;
exports.DenominatorForm = DenominatorForm;
exports.hashCv = hashCv;

exports.createGrDisplaySheet = createGrDisplaySheet;
exports.linkSuffixGr = linkSuffixGr;
exports.linkSuffixPairGr = linkSuffixPairGr;

exports.SvInheritableRelations = [RightDependentLink, RightDependentTrigger, Joining];
