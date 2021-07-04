function rmr(path::String)
	ispath(path) ? (rm(path, recursive = true); 1) : 0
end

const list = [
	# dir
	".github"
	"changes"
	"images"
	"sample-text"
	"snapshot-src"
	# file
	".gitattributes"
	".npmrc"
	"BackersArchive.md"
	"LICENSE.md"
	"PACKAGE-LIST.md"
	"package-lock.json"
]

try
	splitdir(pwd())[2] |> lowercase == "iosevnya" || push!(list, "package.json", "README.md")
	n = rmr.(list) |> sum
	@info "完成 > $n"
catch e
	@info "错误"
	@info e
end
print("> ")
readline()

