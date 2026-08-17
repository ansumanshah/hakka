.PHONY: build run clean open

SCHEME = HakkaDemoApp
PROJECT = HakkaDemoApp.xcodeproj
BUNDLE_ID = com.noodleapps.hakka.ios
DERIVED_DATA_PATH ?= ../../.build/ios-demo

# Auto-detect best available iPhone simulator
LPAREN := (
SIM_NAME ?= $(shell xcrun simctl list devices available 2>/dev/null | grep 'iPhone' | head -1 | tr '$(LPAREN)' '\n' | head -1 | xargs)
DESTINATION = platform=iOS Simulator,name=$(SIM_NAME)

build:
	@echo "Building for simulator: $(SIM_NAME)"
	xcodebuild build \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-destination '$(DESTINATION)' \
		-derivedDataPath '$(DERIVED_DATA_PATH)' \
		CODE_SIGNING_ALLOWED=NO

run:
	@./test.sh

open:
	open $(PROJECT)

clean:
	xcodebuild clean -project $(PROJECT) -scheme $(SCHEME) 2>/dev/null || true
	rm -rf '$(DERIVED_DATA_PATH)'
