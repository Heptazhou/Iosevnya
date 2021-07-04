# Copyright (C) 2022 Heptazhou <zhou@0h7z.com>
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

try
	rm.([".eslintrc.json", ".prettierrc.yaml"], force = true)
	v, r, f = Int[], r"^\t*", "verdafile.mjs"
	s = split(read(f, String), "\n")
	Threads.@threads for i in 2:length(s)-1
		s[i] == "" != match(r, s[i-1]).match == match(r, s[i+1]).match && push!(v, i)
	end
	s = join(deleteat!(s, sort!(v)), "\n")
	s = replace(s, r"((?:if|for|while) \([^\n]+\)|else) \{\n\s*([^\n]+)\n\s*\}" => s"\1 \2")
	s = replace(s, r"((?:if|for|while) \([^\n]+\)|else) \{(\n\s*[^;]+;)\n\s*\}" => s"\1\2")
	s = replace(s, r"((?:if|for|while) \([^\n]+\)|else) \{(\n\s*(?:(?:if|for|while) \([^\n]+\)|else) \{\n\s*[^}]+;\n\s*\}\n)\s*\}\n" => s"\1\2")
	write(f, s)
	@info "完成"
catch e
	@info "错误"
	@info e
end
isempty(ARGS) || exit()
print("> ")
readline()

