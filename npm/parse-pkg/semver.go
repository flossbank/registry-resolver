package parsepkg

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const SemverMaxLength = 256

var looseRe *regexp.Regexp

type Semver struct {
	Major      uint64
	Minor      uint64
	Patch      uint64
	Version    string
	Build      []string
	PreRelease []string
}

func init() {
	buildIdentifier := "[0-9A-Za-z-]+"
	nonNumericIdentifierLoose := "\\d*[a-zA-Z-][a-zA-Z0-9-]*"
	numericIdentifierLoose := "[0-9]+"
	build := fmt.Sprintf("(?:\\+(%s(?:\\.%s)*))", buildIdentifier, buildIdentifier)
	mainVersionLoose := fmt.Sprintf("(%s)\\.(%s)\\.(%s)", numericIdentifierLoose, numericIdentifierLoose, numericIdentifierLoose)
	preReleaseIdentifierLoose := fmt.Sprintf("(?:%s|%s)", numericIdentifierLoose, nonNumericIdentifierLoose)
	preReleaseLoose := fmt.Sprintf("(?:-?(%s(?:\\.%s)*))", preReleaseIdentifierLoose, preReleaseIdentifierLoose)
	loosePlain := fmt.Sprintf("[v=\\s]*%s%s?%s?", mainVersionLoose, preReleaseLoose, build)
	looseReStr := fmt.Sprintf("^%s$", loosePlain)
	looseRe = regexp.MustCompile(looseReStr)
}

func IsValidSemver(version string) bool {
	parsed := ParseSemver(version)
	if parsed.Version != "" {
		return true
	}
	return false
}

func ParseSemver(version string) Semver {
	if len(version) > SemverMaxLength || !looseRe.MatchString(version) {
		return Semver{}
	}
	return newSemver(version)
}

func newSemver(version string) Semver {
	matches := looseRe.FindAllStringSubmatch(version, -1)
	if len(matches) < 1 {
		return Semver{}
	}
	match := matches[0]

	major, err1 := strconv.ParseUint(match[1], 10, 32)
	minor, err2 := strconv.ParseUint(match[2], 10, 32)
	patch, err3 := strconv.ParseUint(match[3], 10, 32)

	if err1 != nil || err2 != nil || err3 != nil {
		return Semver{}
	}

	var preRelease = []string{}
	if match[4] != "" {
		preReleaseSplit := strings.Split(match[4], ".")
		for _, id := range preReleaseSplit {
			if num, err := strconv.ParseUint(id, 10, 32); err != nil {
				preRelease = append(preRelease, strconv.FormatUint(num, 10))
			} else {
				preRelease = append(preRelease, id)
			}
		}
	}

	build := strings.Split(match[5], ".")

	parsedVersion := fmt.Sprintf("%d.%d.%d", major, minor, patch)
	if len(preRelease) > 0 {
		parsedVersion = fmt.Sprintf("%s-%s", parsedVersion, strings.Join(preRelease, "."))
	}

	return Semver{
		Major:      major,
		Minor:      minor,
		Patch:      patch,
		Version:    parsedVersion,
		PreRelease: preRelease,
		Build:      build,
	}
}
