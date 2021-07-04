# Copyright (C) 2021-2022 Heptazhou <zhou@0h7z.com>
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
	# file
	"LICENSE.md"
	"package-lock.json"
	# path
	"utility/amend-readme"
	"utility/copy-char-name-to-markdown.mjs"
	"utility/create-sha-file.mjs"
	"utility/export-data"
	"utility/generate-release-note"
	"utility/generate-samples"
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
isempty(ARGS) || exit()
print("> ")
readline()

