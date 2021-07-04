function rmr(path::String)
	ispath(path) ? (rm(path, recursive = true); 1) : 0
end

list = [
	# dir
	".github"
	"changes"
	"images"
	"sample-text"
	"snapshot-src"
	"utility"
	# file
	".editorconfig"
	".eslintrc.json"
	".gitattributes"
	".npmrc"
	".prettierrc.yaml"
	"BackersArchive.md"
	"build-plans.toml"
	"LICENSE.md"
	"package.json"
	"README.md"
	# path
	"font-src/gen"
	"font-src/glyphs"
	"font-src/index.js"
	"font-src/kits"
	"font-src/meta/aesthetics.ptl"
	"font-src/meta/macros.ptl"
	"font-src/meta/unicode-knowledge.ptl"
	"font-src/otl"
	"font-src/support"
	"params/ligation-set.toml"
	"params/shape-weight.toml"
	"params/shape-width.toml"
	"params/variants.toml"
]

try
	splitdir(pwd())[2] |> lowercase == "iosevnya" && throw("不允许在当前目录运行 已终止")
	n = rmr.(list) |> sum
	@info "完成 > $n"
catch e
	@info "错误"
	@info e
end
print("> ")
readline()

