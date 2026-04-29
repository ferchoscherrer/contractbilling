import BaseComponent from "sap/ui/core/UIComponent";
import { createDeviceModel } from "./model/models";

/**
 * @namespace contractbilling
 */
export default class Component extends BaseComponent {

	public static metadata = {
		manifest: "json",
         config: { 
            fullWidth: true 
                  },
        interfaces: [
            "sap.ui.core.IAsyncContentCreation"
        ]
	};

	public init() : void {
		// call the base component's init function
		super.init();

        // set the device model
        this.setModel(createDeviceModel(), "device");

        // enable routing
        this.getRouter().initialize();
	}
}