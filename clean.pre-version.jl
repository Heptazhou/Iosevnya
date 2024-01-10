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
	"tools"
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
	"packages/font-glyphs"
	"packages/font-kits"
	"packages/font-otl"
	"packages/font/package.json"
	"packages/font/src/derive-spacing.mjs"
	"packages/font/src/finalize"
	"packages/font/src/font-io"
	"packages/font/src/font.mjs"
	"packages/font/src/generated"
	"packages/font/src/hb-compat-ligature"
	"packages/font/src/index.mjs"
	"packages/font/src/merge-cache.mjs"
	"packages/font/src/otd-conv"
	"packages/font/src/ttfa-controls"
	"packages/geometry-cache"
	"packages/geometry"
	"packages/glyph"
	"packages/param"
	"packages/util"
	"params/ligation-set.toml"
	"params/shape-slope.toml"
	"params/shape-weight.toml"
	"params/shape-width.toml"
	"params/variants.toml"
]

try
	occursin(r"iosevnya"i, splitdir(pwd())[2]) && throw("不允许在当前目录运行")
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

