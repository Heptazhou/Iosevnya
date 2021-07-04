# Copyright (C) 2022-2023 Heptazhou <zhou@0h7z.com>
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
	v, f, r = Int[], "verdafile.mjs", r"^[a-z]+(?= \S)|\t*"
	s = split(read(f, String), "\n")
	Threads.@threads for i in eachindex(s[1+begin:end-1])
		s[i] == "" != match(r, s[i-1]).match == match(r, s[i+1]).match && push!(v, i)
	end
	block = "(?:if|for|while) \\([^\n]+\\)|else)"
	s = join(deleteat!(s, sort!(v)), "\n")
	s = replace(s, Regex("($block \\{\n\\s*([^\n]+)\n\\s*\\}") => s"\1 \2")
	s = replace(s, Regex("($block \\{(\n\\s*[^;]+;)\n\\s*\\}") => s"\1\2")
	s = replace(s, Regex("($block \\{(\n\\s*(?:$block \\{\n\\s*[^}]+\n\\s*\\}\n)\\s*\\}\n") => s"\1\2")
	s = replace(s, r"^//[^\n]*\n\K\n+"m => "")
	write(f, s)
	@info "完成"
catch e
	@info "错误"
	@info e
end
isempty(ARGS) || exit()
print("> ")
readline()

