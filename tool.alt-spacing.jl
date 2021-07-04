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

const toml = "private-build-plans.toml"
const opt = ["normal", "fixed"]
const rex = "^spacing(\\s*=\\s*)\"(\\w+)\"" |> s -> Regex(s, "m")

try
	str = read(toml, String)
	old = match(rex, str)[2]
	old ∈ opt || throw("$old ∉ $opt")
	new = filter!(≠(old), opt)[1]
	str = replace(str, rex => SubstitutionString("spacing\\1\"$new\""))
	write(toml, str)
	@info "完成 > $old -> $new"
catch e
	@info "错误"
	@info e
end
isempty(ARGS) || exit()
print("> ")
readline()

