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
	# file
	".gitattributes"
	".npmrc"
	"BackersArchive.md"
	"LICENSE.md"
]

try
	splitdir(pwd())[2] |> lowercase == "iosevnya" || push!(list, "README.md")
	n = rmr.(list) |> sum
	@info "完成 > $n"
catch e
	@info "错误"
	@info e
end
print("> ")
readline()

