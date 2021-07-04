function rmr(path::String)
	ispath(path) ? (rm(path, recursive = true); 1) : 0
end

const list = [
	# dir
	".github"
	"changes"
	"doc"
	"images"
	"sample-text"
	"utility"
	# file
	".editorconfig"
	".eslintrc.json"
	".gitattributes"
	".prettierrc.yaml"
	"build-plans.toml"
	"LICENSE.md"
	"package-lock.json"
	"README.md"
	# path
	"font-src/gen"
	"font-src/glyphs"
	"font-src/index.mjs"
	"font-src/kits"
	"font-src/merge-cache.mjs"
	"font-src/meta/aesthetics.ptl"
	"font-src/meta/macros.ptl"
	"font-src/meta/unicode-knowledge.ptl"
	"font-src/otl"
	"font-src/support"
	"params/ligation-set.toml"
	"params/shape-slope.toml"
	"params/shape-weight.toml"
	"params/shape-width.toml"
	"params/variants.toml"
]

try
	occursin(r"iosevnya"i, splitdir(pwd())[2]) && throw("不允许在当前目录运行")
	n = rmr.(list) |> sum
	@info "完成 > $n"
catch e
	@info "错误"
	@info e
end
isempty(ARGS) || exit()
print("> ")
readline()

