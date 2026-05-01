import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import Fragment from "sap/ui/core/Fragment";
import ODataModel from "sap/ui/model/odata/v2/ODataModel";
import Dialog from "sap/m/Dialog";
import ODataListBinding from "sap/ui/model/odata/v2/ODataListBinding";
import Filter from "sap/ui/model/Filter";
import UIComponent from "sap/ui/core/UIComponent";
import FilterOperator from "sap/ui/model/FilterOperator";
import Router from "sap/ui/core/routing/Router";
import MessageToast from "sap/m/MessageToast";
import MultiInput from "sap/m/MultiInput";
import Token from "sap/m/Token";
import DateRangeSelection from "sap/m/DateRangeSelection";
import MultiComboBox from "sap/m/MultiComboBox";

/**
 * @namespace contractbilling.controller
 */
export default class Main extends Controller {

    private oBillingContract: JSONModel;
    private oRouter: Router;
    private ZSD_CATALOGOS_SRV: ODataModel;
    private oFragmentCustomer: Dialog;
    private ZSD_GET_CONTRACT_BILLING_SRV: ODataModel;

    public onInit(): void {
        this.oBillingContract = this.getOwnerComponent()?.getModel("mBillingContract") as JSONModel;
        this.oRouter = (this.getOwnerComponent() as UIComponent).getRouter();
        this.ZSD_CATALOGOS_SRV = this.getOwnerComponent()?.getModel("ZSD_CATALOGOS_SRV") as ODataModel
        this.ZSD_GET_CONTRACT_BILLING_SRV = this.getOwnerComponent()?.getModel("ZSD_GET_CONTRACT_BILLING_SRV") as ODataModel;
    }

    public onLiveChangeMultiInput(oEvent: any): void {
        const oMultiInput = oEvent.getSource() as MultiInput;
        const sValue = oEvent.getParameter("newValue") || "";

        if (sValue.includes("\n") || sValue.includes("\r") || sValue.includes("\t") || sValue.includes(" ")) {
            const aValues = sValue.split(/[\s,\t\n\r]+/);

            aValues.forEach((sVal: string) => {
                const sTrim = sVal.trim();
                if (sTrim) {
                    const bExists = oMultiInput.getTokens().some((oT: any) => oT.getKey() === sTrim);
                    if (!bExists) {
                        oMultiInput.addToken(new Token({ key: sTrim, text: sTrim }));
                    }
                }
            });
            oMultiInput.setValue("");
        }
    }

    public onTokenUpdate(oEvent: any): void {
        const oMultiInput = oEvent.getSource() as MultiInput;
        const sValue = oMultiInput.getValue();
        
        if (sValue) {
            const sTrim = sValue.trim();
            if (sTrim && !oMultiInput.getTokens().some((oT: any) => oT.getKey() === sTrim)) {
                oMultiInput.addToken(new Token({ key: sTrim, text: sTrim }));
            }
            oMultiInput.setValue("");
        }
    }

   public onOpenListContract(): void {
        const aCustomers = (this.byId("miCustomer") as MultiInput).getTokens().map(t => t.getKey());
        const aQuotations = (this.byId("miQuotation") as MultiInput).getTokens().map(t => t.getKey());
        const oDRS = this.byId("DRPBillingDate") as DateRangeSelection;
        const oDateStart = oDRS.getDateValue();
        const oDateEnd = oDRS.getSecondDateValue();
        const aStatus = (this.byId("mcbStatus") as MultiComboBox).getSelectedKeys();

        // --- VALIDACIÓN Y FORMATEO DE FECHAS ---
        let sDateRangeParam = "all";
        if (oDateStart && oDateEnd) {
            const sIni = this._formatDate(oDateStart);
            const sFin = this._formatDate(oDateEnd);
            if (sIni !== "" && sFin !== "") {
                sDateRangeParam = `${sIni}_${sFin}`;
            }
        }

        // Actualizar modelo local
        this.oBillingContract.setProperty("/oQuery/selectedCustomers", aCustomers);
        this.oBillingContract.setProperty("/oQuery/selectedQuotations", aQuotations);
        this.oBillingContract.setProperty("/oQuery/selectedStatus", aStatus);

        // Lógica de parámetro de cliente
        let sCustomerParam = "all";
        if (aCustomers.length === 1) {
            sCustomerParam = aCustomers[0];
        } else if (aCustomers.length > 1) {
            sCustomerParam = "multi";
        }

        // --- NAVEGACIÓN CON QUERY PARAMETERS PARA F5 ---
        this.oRouter.navTo("RouteContractDetail", {
            customerId: sCustomerParam,
            date: sDateRangeParam,
            // El objeto query se traduce a ?status=...&quotation=... en la URL
            query: {
                status: aStatus.join(","),
                quotation: aQuotations.join(","),
                customers: aCustomers.join(",")
            }
        });
    }




    private _formatDate(oDate: Date | null): string {
        // Validamos que sea un objeto Date real y que no sea una fecha inválida
        if (!(oDate instanceof Date) || isNaN(oDate.getTime())) {
            return "";
        }

        const day = ("0" + oDate.getDate()).slice(-2);
        const month = ("0" + (oDate.getMonth() + 1)).slice(-2);
        const year = oDate.getFullYear();
        
        return `${year}${month}${day}`;
    }




    public async onOpenPopUpiptCustomer(): Promise<void> {
        this.oFragmentCustomer ??= await Fragment.load({
            id: this.getView()?.getId(),
            name: "contractbilling.view.fragment.TblCustomer",
            controller: this,
        }) as Dialog;

        this.getView()?.addDependent(this.oFragmentCustomer);
        this.oFragmentCustomer.open();
    }

    public onSearchCustomer(oEvent: any): void {
        const sValue = oEvent.getParameter("value") || "";
        const oBinding = oEvent.getSource().getBinding("items") as ODataListBinding;

        if (oBinding) {
            const oFilter = new Filter({
                filters: [
                    new Filter("CustomerCode", FilterOperator.Contains, sValue),
                    new Filter("Name1", FilterOperator.Contains, sValue)
                ],
                and: false
            });
            oBinding.filter([oFilter]);
        }
    }

    public onSelectCustomer(oEvent: any): void {
        const aSelectedContexts = oEvent.getParameter("selectedContexts");
        const oMultiInput = this.byId("miCustomer") as MultiInput;

        if (aSelectedContexts && aSelectedContexts.length > 0) {
            aSelectedContexts.forEach((oCtx: any) => {
                const oCustomer = oCtx.getObject();
                const sKey = oCustomer.CustomerCode || oCustomer.Kunnr;
                const sName = oCustomer.Name1 || sKey;
                
                if (!oMultiInput.getTokens().some(oT => oT.getKey() === sKey)) {
                    oMultiInput.addToken(new Token({ key: sKey, text: sName }));
                }
            });
            this.oFragmentCustomer.close();
            oMultiInput.setValue("");
        }
    }
    
    public onClearFilter(): void {
        this.oBillingContract.setProperty("/oQuery", {
            selectCustomer: {},
            selectQuotationNumber: {},
            selectedCustomers: [],
            selectedQuotations: [],
            selectedStatus: [],
            date: null
        });
        
        // Limpiar sesión también al resetear filtros
        sessionStorage.removeItem("lastBillingQuery");
        
        (this.byId("miCustomer") as MultiInput).removeAllTokens();
        (this.byId("miQuotation") as MultiInput).removeAllTokens();
        (this.byId("DRPBillingDate") as DateRangeSelection).setValue("");
        (this.byId("mcbStatus") as MultiComboBox).setSelectedKeys([]);
        
        MessageToast.show("Filtros limpiados");
    }
}