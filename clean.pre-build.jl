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
	"snapshot-src"
	# file
	".npmrc"
	"BackersArchive.md"
	"LICENSE.md"
	"PACKAGE-LIST.md"
	"package-lock.json"
	# path
	"utility/amend-readme"
	"utility/ensure-verda-exists.js"
	"utility/export-data"
	"utility/generate-change-log"
	"utility/generate-release-note"
	"utility/generate-snapshot-page"
	"utility/update-package-json-version"
]

try
	occursin(r"iosevnya"i, splitdir(pwd())[2]) || push!(list, ".gitattributes", "package.json", "README.md")
	n = rmr.(list) |> sum
	@info "完成 > $n"
catch e
	@info "错误"
	@info e
end
length(ARGS) > 0 && exit()
print("> ")
readline()

