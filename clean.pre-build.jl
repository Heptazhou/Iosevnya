# Copyright (C) 2021-2024 Heptazhou <zhou@0h7z.com>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

const fix(f::String, n::Int) = fix(f, Regex("^\\t*\\K {$n}", "m"))
const fix(f::String, r::Regex) =
	for (prefix, ds, fs) ∈ walkdir(".") |> collect
		prefix = replace(prefix, '\\' => '/') * '/'
		contains(prefix, "/.git/") && continue
		contains(prefix, "/node_modules/") && continue
		f ∈ fs && cd(prefix) do
			s = t = read(f, String)
			while contains(s, r)
				s = replace(s, r => '\t')
			end
			s ≠ t && write(f, s)
		end
	end

const rmr(path::String)::Int =
	ispath(path) ? (rm(path, recursive = true); 1) : 0

const list = [
	# dir
	".github"
	"changes"
	"doc"
	"images"
	"sample-text"
	# file
	"LICENSE.md"
	"package-lock.json"
	# path
	"tools/amend-readme"
	"tools/data-export"
	"tools/generate-samples"
	"tools/misc/src/copy-char-name-to-markdown.mjs"
	"tools/misc/src/create-sha-file.mjs"
	"tools/misc/src/generate-ttfa-ranges.mjs"
	"tools/misc/src/update-package-json-version.mjs"
]

try
	occursin(r"iosevnya"i, splitdir(pwd())[2]) || push!(list, ".gitattributes", "package.json", "README.md")
	fix.(["CHANGELOG.md", "package.json"], 2)
	n = sum(rmr, list)
	@info "完成 > $n"
catch e
	@info "错误"
	@info e
end
isempty(ARGS) || exit()
print("> ")
readline()

