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
	"font-src/derive-spacing.mjs"
	"font-src/gen/build-font.mjs"
	"font-src/gen/caching"
	"font-src/gen/finalize"
	"font-src/gen/meta/empty-font.mjs"
	"font-src/gen/otd-conv"
	"font-src/glyphs"
	"font-src/index.mjs"
	"font-src/kits"
	"font-src/merge-cache.mjs"
	"font-src/meta"
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

